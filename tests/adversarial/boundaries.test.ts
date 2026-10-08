import { afterEach, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProject, parseProject, serializeProject } from '../../src/core/project.js';
import { workflowHash } from '../../src/core/fingerprint.js';
import { loadRun } from '../../src/core/run.js';
import { exportRun } from '../../src/media/export.js';
import type { Project, RunResult } from '../../src/shared/types.js';

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'demoforge-adversarial-'));
  temporaryRoots.push(root);
  return root;
}

function workflow(): Project {
  const project = createProject('Synthetic shop checkout');
  project.steps = [{ id: 'checkout', name: 'Checkout', action: 'wait', timeoutMs: 1_000, pauseMs: 0 }];
  return project;
}

function passedRun(project: Project, overrides: Partial<RunResult> = {}): RunResult {
  return {
    schemaVersion: 1,
    status: 'passed',
    projectName: project.name,
    workflowHash: workflowHash(project),
    startedAt: '2026-10-08T00:00:00.000Z',
    durationMs: 1_000,
    cursor: [],
    steps: project.steps.map((step) => ({
      id: step.id,
      name: step.name,
      status: 'passed',
      startMs: 0,
      endMs: 100,
    })),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('adversarial project and run boundaries', () => {
  test('rejects an accessor on a declared project field without invoking it during serialization', () => {
    const project = createProject('Safe project');
    let getterCalled = false;
    Object.defineProperty(project, 'name', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalled = true;
        throw new Error('attacker-controlled getter ran');
      },
    });

    expect(() => serializeProject(project)).toThrow(/project\.name.*data property/i);
    expect(getterCalled).toBe(false);
  });

  test('rejects file URLs as workflow navigation targets', () => {
    const project = workflow();
    project.steps[0] = {
      id: 'open-local-file',
      name: 'Open local file',
      action: 'navigate',
      target: 'file:///C:/Users/example/private.html',
      timeoutMs: 1_000,
      pauseMs: 0,
    };

    expect(() => parseProject(project)).toThrow(/HTTP or HTTPS/i);
  });

  test('loads run files through malformed JSON and unsupported-version cases', async () => {
    const root = await temporaryRoot();
    const project = workflow();
    const report = path.join(root, 'run.json');
    await writeFile(report, '{"schemaVersion":', 'utf8');
    await expect(loadRun(report, project)).rejects.toThrow(/valid JSON/i);

    await writeFile(report, JSON.stringify({ ...passedRun(project), schemaVersion: 73 }), 'utf8');
    await expect(loadRun(report, project)).rejects.toThrow(/version/i);
  });

  test('rejects undeclared secret payloads in serialized run reports without echoing their value', async () => {
    const root = await temporaryRoot();
    const project = workflow();
    const report = path.join(root, 'run.json');
    const secretCanary = 'SYNTHETIC_RUN_SECRET_6ec2';
    const run = passedRun(project) as RunResult & { privatePayload?: string };
    run.privatePayload = secretCanary;
    await writeFile(report, JSON.stringify(run), 'utf8');

    let rejection: unknown;
    try {
      await loadRun(report, project);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toMatch(/invalid fields/i);
    expect(String(rejection)).not.toContain(secretCanary);
  });

  test('rejects relative parent traversal in run media references', async () => {
    const root = await temporaryRoot();
    const capture = path.join(root, 'capture');
    const report = path.join(capture, 'run.json');
    await mkdir(capture);
    const project = workflow();
    await writeFile(report, JSON.stringify(passedRun(project, { video: path.join('..', 'outside.webm') })), 'utf8');

    await expect(loadRun(report, project)).rejects.toThrow(/capture directory/i);
  });

  test('rejects a media link that resolves outside the run capture directory', async () => {
    const root = await temporaryRoot();
    const capture = path.join(root, 'capture');
    const report = path.join(capture, 'run.json');
    const externalDirectory = path.join(root, 'outside');
    const externalVideo = path.join(externalDirectory, 'outside.webm');
    const linkedDirectory = path.join(capture, 'linked');
    const linkedVideo = path.join(linkedDirectory, 'outside.webm');
    await mkdir(capture);
    await mkdir(externalDirectory);
    await writeFile(externalVideo, 'synthetic media');
    await symlink(externalDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');

    const project = workflow();
    await writeFile(report, JSON.stringify(passedRun(project, { video: linkedVideo })), 'utf8');
    await expect(loadRun(report, project)).rejects.toThrow(/capture directory/i);
  });

  test.each(['crop', 'mask'] as const)('rejects numeric strings in adversarial %s geometry before creating export output', async (kind) => {
    const root = await temporaryRoot();
    const project = workflow();
    const unsafe = project as Project & { edits: Project['edits'] };
    if (kind === 'crop') {
      unsafe.edits.crop = { x: '0', y: 0, width: 120, height: 80 } as unknown as NonNullable<Project['edits']['crop']>;
    } else {
      unsafe.edits.masks = [{ id: 'mask', x: 0, y: '0', width: 120, height: 80, startMs: 0, endMs: 500 } as unknown as Project['edits']['masks'][number]];
    }
    const output = path.join(root, 'shared');

    await expect(exportRun(project, passedRun(project), {
      outputDir: output,
      formats: ['markdown'],
      reviewed: true,
      ffmpegPath: path.join(root, 'unused-ffmpeg.exe'),
    })).rejects.toThrow(/finite number/i);
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('preserves unrelated files and removes staging output when FFmpeg fails after export starts', async () => {
    const root = await temporaryRoot();
    const project = workflow();
    const video = path.join(root, 'capture.webm');
    const sentinel = path.join(root, 'keep.txt');
    const output = path.join(root, 'shared');
    await writeFile(video, 'synthetic non-video payload');
    await writeFile(sentinel, 'preserve this file');

    await expect(exportRun(project, passedRun(project, { video }), {
      outputDir: output,
      formats: ['mp4'],
      reviewed: true,
      ffmpegPath: path.join(root, 'missing-ffmpeg.exe'),
    })).rejects.toThrow(/FFmpeg could not process/i);

    expect(await readdir(root)).not.toContain('shared');
    expect((await readdir(root)).filter((name) => name.startsWith('.demoforge-export-'))).toEqual([]);
    expect(await readFile(sentinel, 'utf8')).toBe('preserve this file');
  });
});
