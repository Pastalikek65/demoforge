import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exportRun } from '../../src/media/export.js';
import { workflowHash } from '../../src/core/fingerprint.js';
import type { Project, RunResult } from '../../src/shared/types.js';

const execute = promisify(execFile);
const ffmpeg = process.env.DEMOFORGE_FFMPEG ?? 'ffmpeg';
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('timed mask and frame-rate composition', () => {
  test('applies a timed mask to every normalized output frame at its start boundary', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'demoforge-release-mask-'));
    directories.push(directory);
    const video = path.join(directory, 'capture.webm');
    await execute(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=10:d=2',
      '-vf', 'drawbox=x=60:y=40:w=20:h=20:color=blue:t=fill', '-c:v', 'libvpx', video,
    ]);

    const project: Project = {
      schemaVersion: 1,
      name: 'Mask cadence fixture',
      viewport: { width: 160, height: 120 },
      steps: [{ id: 'step', name: 'Wait', action: 'wait', timeoutMs: 1_000, pauseMs: 0 }],
      variables: [],
      edits: {
        trimStartMs: 0,
        masks: [{ id: 'mask', x: 60, y: 40, width: 20, height: 20, startMs: 620, endMs: 2_000 }],
        annotations: [],
        zooms: [{ startMs: 0, endMs: 2_000, scale: 1, x: 80, y: 60 }],
        cursorHighlight: false,
      },
    };
    const run: RunResult = {
      schemaVersion: 1,
      status: 'passed',
      projectName: project.name,
      workflowHash: workflowHash(project),
      startedAt: '2026-10-08T00:00:00Z',
      durationMs: 2_000,
      video,
      cursor: [],
      steps: [{ id: 'step', name: 'Wait', status: 'passed', startMs: 0, endMs: 2_000 }],
    };
    const outputDir = path.join(directory, 'export');
    await exportRun(project, run, { outputDir, formats: ['mp4'], reviewed: true, ffmpegPath: ffmpeg });

    const pixels = await execute(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-ss', '0.64', '-i', path.join(outputDir, 'demo.mp4'),
      '-frames:v', '1', '-vf', 'crop=2:2:68:48', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-',
    ], { encoding: 'buffer' });

    expect(pixels.stdout.length).toBe(12);
    expect(Math.max(...pixels.stdout)).toBeLessThan(15);
  });
});
