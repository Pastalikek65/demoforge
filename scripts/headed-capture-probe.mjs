import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const runCount = 20;
const viewport = { width: 1280, height: 720 };
const viewportLabel = `${viewport.width}x${viewport.height}`;
const screenshotTimeoutMs = 5_000;
const frameTimeoutMs = 2_000;
const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Capture probe</title><style>
  html, body { width: 100%; height: 100%; margin: 0; background: #2878c8; }
  #fixture-ready { position: fixed; left: 24px; top: 24px; color: white; font: 24px sans-serif; }
</style></head><body><main id="fixture-ready">Headed capture probe</main></body></html>`;
const fsErrorCodes = new Set(['EACCES', 'EBUSY', 'EEXIST', 'EIO', 'EISDIR', 'ENOSPC', 'ENOTDIR', 'ENOENT', 'EPERM', 'EROFS']);

function readErrorField(error, field) {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return undefined;
  try {
    const value = Reflect.get(error, field);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function pageClosedState(page) {
  if (!page) return null;
  try { return page.isClosed(); } catch { return null; }
}

function classifyFailure(error, page) {
  const code = readErrorField(error, 'code');
  const errorName = readErrorField(error, 'name');
  const message = readErrorField(error, 'message') ?? '';
  if (code && fsErrorCodes.has(code)) return `FS_${code}`;
  if (message === 'FRAME_WAIT_TIMEOUT') return 'FRAME_WAIT_TIMEOUT';
  if (/\bTarget crashed\b/i.test(message)) return 'TARGET_CRASHED';
  if (pageClosedState(page) === true) return 'PAGE_CLOSED';
  if (errorName === 'TargetClosedError' || /\b(?:Target closed|Page closed|Target page, context or browser has been closed)\b/i.test(message)) return 'TARGET_CLOSED';
  if (errorName === 'TimeoutError' || /\bTimeout \d+ms exceeded\b/i.test(message)) return 'TIMEOUT';
  if (/\bUnable to capture screenshot\b/i.test(message)) return 'CAPTURE_REJECTED';
  return 'OTHER';
}

function inspectPng(png) {
  if (!Buffer.isBuffer(png) || png.length < 33
    || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || png.toString('ascii', 12, 16) !== 'IHDR') return { valid: false, cause: 'PNG_INVALID' };
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  let offset = 8;
  let hasNonemptyImageData = false;
  while (offset + 12 <= png.length) {
    const chunkLength = png.readUInt32BE(offset);
    const end = offset + 12 + chunkLength;
    if (end > png.length) return { valid: false, cause: 'PNG_INVALID' };
    const chunkType = png.toString('ascii', offset + 4, offset + 8);
    if (chunkType === 'IDAT' && chunkLength > 0) hasNonemptyImageData = true;
    if (chunkType === 'IEND') break;
    offset = end;
  }
  if (!hasNonemptyImageData) return { valid: false, cause: 'PNG_INVALID', width, height };
  if (width !== viewport.width || height !== viewport.height) return { valid: false, cause: 'PNG_DIMENSIONS_MISMATCH', width, height };
  return { valid: true, width, height };
}

async function capture(page, outputPath, step) {
  const pageClosedBefore = pageClosedState(page);
  try {
    const bytes = await page.screenshot({ path: outputPath, timeout: screenshotTimeoutMs, animations: 'disabled' });
    const image = inspectPng(bytes);
    return {
      step,
      status: image.valid ? 'passed' : 'failed',
      ...(image.valid ? { image: { width: image.width, height: image.height, nonempty: true } } : { cause: image.cause, image: { width: image.width ?? null, height: image.height ?? null, nonempty: false } }),
      viewport: viewportLabel,
      pageClosed: pageClosedState(page),
    };
  } catch (error) {
    return { step, status: 'failed', cause: classifyFailure(error, page), viewport: viewportLabel, pageClosed: pageClosedState(page) ?? pageClosedBefore };
  }
}

async function waitForTwoFrames(page) {
  // This bounds two requestAnimationFrame callbacks; it is a render-opportunity marker, not presentation proof.
  let timer;
  try {
    await Promise.race([
      page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('FRAME_WAIT_TIMEOUT')), frameTimeoutMs); }),
    ]);
    return { status: 'passed' };
  } catch (error) {
    return { status: 'failed', cause: classifyFailure(error, page) };
  } finally {
    clearTimeout(timer);
  }
}

function summarize(attempts) {
  let passed = 0;
  let failed = 0;
  let notRun = 0;
  const causeCounts = new Map();
  for (const result of attempts) {
    if (result.status === 'passed') passed += 1;
    else if (result.status === 'failed') {
      failed += 1;
      if (result.cause) causeCounts.set(result.cause, (causeCounts.get(result.cause) ?? 0) + 1);
    } else notRun += 1;
  }
  return { passed, failed, notRun, causes: [...causeCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([cause, count]) => ({ cause, count })) };
}

async function runArm(ownedRoot, runNumber, condition, fixtureUrl) {
  const step = condition === 'immediate' ? 1 : 2;
  const result = {
    condition,
    launch: { status: 'not-run' },
    setup: { status: 'not-run', viewport: viewportLabel, pageClosed: null },
    frameWait: condition === 'twoFrames' ? { status: 'not-run' } : { status: 'not-applicable' },
    capture: { step, status: 'not-run', viewport: viewportLabel, pageClosed: null },
  };
  let browser;
  let context;
  let page;
  try {
    const runDirectory = path.join(ownedRoot, `round-${runNumber}-${condition}`);
    await mkdir(runDirectory, { recursive: true });
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    result.launch = { status: 'passed' };
    context = await browser.newContext({ viewport, recordVideo: { dir: runDirectory, size: viewport } });
    page = await context.newPage();
    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    result.setup = { status: 'passed', viewport: viewportLabel, pageClosed: pageClosedState(page) };
    if (condition === 'twoFrames') {
      result.frameWait = await waitForTwoFrames(page);
      if (result.frameWait.status !== 'passed') {
        result.capture = { step, status: 'not-run', viewport: viewportLabel, pageClosed: pageClosedState(page) };
        return result;
      }
    }
    result.capture = await capture(page, path.join(runDirectory, `${condition}.png`), step);
  } catch (error) {
    const cause = classifyFailure(error, page);
    if (result.launch.status === 'not-run') result.launch = { status: 'failed', cause: 'BROWSER_LAUNCH_FAILED' };
    else if (result.setup.status === 'not-run') result.setup = { status: 'failed', cause, viewport: viewportLabel, pageClosed: pageClosedState(page) };
    else result.capture = { step, status: 'failed', cause, viewport: viewportLabel, pageClosed: pageClosedState(page) };
  } finally {
    try { if (context) await context.close(); } catch { /* Probe output contains status codes only. */ }
    try { if (browser?.isConnected()) await browser.close(); } catch { /* Probe output contains status codes only. */ }
  }
  return result;
}

function within(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function runProbe() {
  const tempRoot = path.resolve(os.tmpdir());
  const ownedRoot = path.resolve(await mkdtemp(path.join(tempRoot, 'demoforge-headed-capture-probe-')));
  if (!within(tempRoot, ownedRoot)) throw new Error('PROBE_TEMP_ROOT_INVALID');
  let server;
  const records = [];
  try {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(fixtureHtml);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('PROBE_SERVER_SETUP_FAILED');
    const fixtureUrl = `http://127.0.0.1:${address.port}/capture`;

    for (let index = 1; index <= runCount; index += 1) {
      const order = index % 2 === 1 ? ['immediate', 'twoFrames'] : ['twoFrames', 'immediate'];
      const record = { round: index, order };
      for (const condition of order) record[condition] = await runArm(ownedRoot, index, condition, fixtureUrl);
      records.push(record);
    }
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(() => resolve()));
    if (within(tempRoot, ownedRoot)) await rm(ownedRoot, { recursive: true, force: true });
  }

  const attempts = (condition, field) => records.map((record) => record[condition][field]);
  return {
    schemaVersion: 1,
    pairedRounds: runCount,
    coldBrowserLaunches: runCount * 2,
    viewport: viewportLabel,
    launch: {
      immediate: summarize(attempts('immediate', 'launch')),
      afterTwoFrames: summarize(attempts('twoFrames', 'launch')),
    },
    setup: {
      immediate: summarize(attempts('immediate', 'setup')),
      afterTwoFrames: summarize(attempts('twoFrames', 'setup')),
    },
    frameWait: summarize(attempts('twoFrames', 'frameWait')),
    capture: {
      immediateAfterDomContentLoaded: summarize(attempts('immediate', 'capture')),
      afterTwoAnimationFrames: summarize(attempts('twoFrames', 'capture')),
    },
    records,
  };
}

try {
  const result = await runProbe();
  process.stdout.write(`[headed-capture-probe] ${JSON.stringify(result)}\n`);
} catch {
  process.stdout.write('[headed-capture-probe] {"schemaVersion":1,"status":"PROBE_SETUP_FAILED"}\n');
  process.exitCode = 1;
}
