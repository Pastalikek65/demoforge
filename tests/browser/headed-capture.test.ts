import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { replay } from '../../src/browser/runner.js';
import type { Project } from '../../src/shared/types.js';

const runCount = 20;
const viewport = { width: 1280, height: 720 };
const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Capture fixture</title><style>
  html, body { width: 100%; height: 100%; margin: 0; background: #2878c8; }
  #fixture-ready { position: fixed; left: 24px; top: 24px; color: white; font: 24px sans-serif; }
</style></head><body><main id="fixture-ready">Headed capture fixture</main></body></html>`;

let ownedDirectory: string | undefined;
let fixtureServer: Server | undefined;

afterEach(async () => {
  if (fixtureServer?.listening) {
    await new Promise<void>((resolve, reject) => fixtureServer!.close((error) => error ? reject(error) : resolve()));
  }
  fixtureServer = undefined;
  if (ownedDirectory) await rm(ownedDirectory, { recursive: true, force: true });
  ownedDirectory = undefined;
});

function makeProject(url: string): Project {
  return {
    schemaVersion: 1,
    name: 'Headed capture fixture',
    viewport,
    steps: [
      { id: 'open', name: 'Open local fixture', action: 'navigate', target: url, timeoutMs: 10_000, pauseMs: 0 },
      { id: 'ready', name: 'Wait for fixture content', action: 'wait', target: '#fixture-ready', timeoutMs: 10_000, pauseMs: 0 },
    ],
    variables: [],
    edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: false },
  };
}

function safeFailureSummary(result: Awaited<ReturnType<typeof replay>>): string {
  return JSON.stringify({
    status: result.status,
    steps: result.steps.map(({ id, status, error }) => ({ id, status, error: error ?? null })),
  });
}

function hasNonemptyPngImageData(png: Buffer): boolean {
  let offset = 8;
  while (offset + 12 <= png.length) {
    const chunkLength = png.readUInt32BE(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > png.length) return false;
    const chunkType = png.toString('ascii', offset + 4, offset + 8);
    if (chunkType === 'IDAT') return chunkLength > 0;
    if (chunkType === 'IEND') return false;
    offset = chunkEnd;
  }
  return false;
}

describe('headed Chromium screenshot capture', () => {
  it('captures valid screenshots across twenty fresh sandboxed browser runs', async () => {
    ownedDirectory = await mkdtemp(join(tmpdir(), 'demoforge-headed-capture-'));
    fixtureServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(fixtureHtml);
    });
    await new Promise<void>((resolve, reject) => {
      fixtureServer!.once('error', reject);
      fixtureServer!.listen(0, '127.0.0.1', resolve);
    });
    const address = fixtureServer.address();
    if (!address || typeof address === 'string') throw new Error('Headed capture fixture could not bind locally.');
    const url = `http://127.0.0.1:${address.port}/capture`;

    for (let index = 0; index < runCount; index += 1) {
      const run = await replay(makeProject(url), {
        outputDir: join(ownedDirectory, `run-${index + 1}`),
        headless: false,
      });
      const runNumber = index + 1;
      expect(run.status, `headed capture run ${runNumber}: ${safeFailureSummary(run)}`).toBe('passed');
      expect(run.steps.map((step) => step.status), `headed capture run ${runNumber}: ${safeFailureSummary(run)}`).toEqual(['passed', 'passed']);

      for (const step of run.steps) {
        expect(step.screenshot, `headed capture run ${runNumber}, step ${step.id}: ${safeFailureSummary(run)}`).toBeTruthy();
        let png: Buffer;
        try {
          png = await readFile(step.screenshot!);
        } catch {
          throw new Error(`Headed capture run ${runNumber}, step ${step.id} did not leave a readable PNG.`);
        }
        expect(png.length, `headed capture run ${runNumber}, step ${step.id} should produce nonempty PNG bytes`).toBeGreaterThan(32);
        expect(png.subarray(0, 8), `headed capture run ${runNumber}, step ${step.id} PNG signature`).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
        expect(png.toString('ascii', 12, 16), `headed capture run ${runNumber}, step ${step.id} PNG IHDR`).toBe('IHDR');
        expect(png.readUInt32BE(16), `headed capture run ${runNumber}, step ${step.id} PNG width`).toBe(viewport.width);
        expect(png.readUInt32BE(20), `headed capture run ${runNumber}, step ${step.id} PNG height`).toBe(viewport.height);
        expect(hasNonemptyPngImageData(png), `headed capture run ${runNumber}, step ${step.id} should contain nonempty PNG image data`).toBe(true);
      }
    }
  }, 90_000);
});
