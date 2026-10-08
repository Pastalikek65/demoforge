import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildEffects } from '../../src/media/effects.js';
import type { Project, RunResult } from '../../src/shared/types.js';

const execute = promisify(execFile);
const ffmpeg = process.env.DEMOFORGE_FFMPEG ?? 'ffmpeg';
const directories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'demoforge-effects-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function makeProject(): Project {
  return {
    schemaVersion: 1,
    name: 'Effects fixture',
    viewport: { width: 160, height: 120 },
    steps: [{ id: 'step', name: 'Wait', action: 'wait', timeoutMs: 1_000, pauseMs: 0 }],
    variables: [],
    edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: false },
  };
}

function makeRun(video: string, cursor: RunResult['cursor'] = []): RunResult {
  return {
    schemaVersion: 1,
    status: 'passed',
    projectName: 'Effects fixture',
    startedAt: '2026-10-08T00:00:00Z',
    durationMs: 2_000,
    video,
    steps: [{ id: 'step', name: 'Wait', status: 'passed', startMs: 0, endMs: 2_000 }],
    cursor,
  };
}

async function makeVideo(directory: string, pattern: 'solid' | 'focus' = 'solid'): Promise<string> {
  const video = path.join(directory, 'source.mp4');
  const filters = pattern === 'focus' ? ['-vf', 'drawbox=x=100:y=40:w=40:h=40:color=blue:t=fill'] : [];
  await execute(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=25:d=2',
    ...filters, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-pix_fmt', 'yuv420p', video,
  ]);
  return video;
}

async function encodeWithEffects(directory: string, project: Project, run: RunResult): Promise<string> {
  const staging = path.join(directory, 'staging');
  await mkdir(staging);
  const { filters, audioArgs } = await buildEffects(project, run, staging);
  const output = path.join(directory, 'edited.mp4');
  await execute(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', run.video!, ...audioArgs,
    ...(filters.length ? ['-vf', filters.join(',')] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-pix_fmt', 'yuv420p', '-map_metadata', '-1', output,
  ], { cwd: staging, windowsHide: true, timeout: 30_000 });
  return output;
}

async function frame(directory: string, video: string, timeSeconds: number): Promise<Buffer> {
  const result = await execute(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', video, '-ss', String(timeSeconds), '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-',
  ], { cwd: directory, encoding: 'buffer', windowsHide: true });
  return result.stdout;
}

function pixel(pixels: Buffer, x: number, y: number): number[] {
  const offset = (y * 160 + x) * 3;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
}

function countNonRedPixels(pixels: Buffer, x0: number, y0: number, x1: number, y1: number): number {
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const [red, green, blue] = pixel(pixels, x, y);
      if (green > 80 || blue > 80 || red < 180) count += 1;
    }
  }
  return count;
}

describe('real FFmpeg editing effects', () => {
  test('zooms toward the configured focus while retaining the viewport dimensions', async () => {
    const directory = await makeDirectory();
    const video = await makeVideo(directory, 'focus');
    const project = makeProject();
    project.edits.zooms = [{ startMs: 500, endMs: 1_500, scale: 2, x: 120, y: 60 }];

    const output = await encodeWithEffects(directory, project, makeRun(video));
    const before = await frame(directory, output, 0.2);
    const during = await frame(directory, output, 0.8);
    const after = await frame(directory, output, 1.6);
    const info = await execute(ffmpeg, ['-hide_banner', '-loglevel', 'info', '-i', output, '-vf', 'showinfo', '-frames:v', '1', '-f', 'null', '-'], { cwd: directory });

    expect(before.length).toBe(160 * 120 * 3);
    expect(during.length).toBe(160 * 120 * 3);
    expect(after.length).toBe(160 * 120 * 3);
    expect(pixel(before, 80, 60)[2]).toBeLessThan(80);
    expect(pixel(during, 80, 60)[2]).toBeGreaterThan(150);
    expect(pixel(after, 80, 60)[2]).toBeLessThan(80);
    expect(info.stderr).toMatch(/s:160x120/);
  });

  test('renders timed annotation text and keeps ASS and filter syntax inert', async () => {
    const directory = await makeDirectory();
    const video = await makeVideo(directory);
    const project = makeProject();
    project.edits.annotations = [{
      id: 'caption',
      text: 'SAFE {\\blur100\\bord0} %{1+1}, drawbox=x=0:y=0',
      startMs: 500,
      endMs: 1_000,
    }];

    const output = await encodeWithEffects(directory, project, makeRun(video));
    const active = await frame(directory, output, 0.7);
    const inactive = await frame(directory, output, 1.5);
    const activeChanges = countNonRedPixels(active, 0, 72, 160, 120);
    const inactiveChanges = countNonRedPixels(inactive, 0, 72, 160, 120);

    expect(activeChanges).toBeGreaterThan(8);
    expect(inactiveChanges).toBe(0);
    const subtitles = await readFile(path.join(directory, 'staging', 'annotations.ass'), 'utf8');
    expect(subtitles).toContain('SAFE');
    expect(subtitles).toContain('SAFE \\{\\\\blur100\\\\bord0\\}');
  });

  test('highlights the recorded cursor position only during sampled cursor activity', async () => {
    const directory = await makeDirectory();
    const video = await makeVideo(directory);
    const project = makeProject();
    project.edits.cursorHighlight = true;
    const run = makeRun(video, [
      { timeMs: 500, x: 40, y: 40 },
      { timeMs: 900, x: 120, y: 40 },
    ]);

    const output = await encodeWithEffects(directory, project, run);
    const active = await frame(directory, output, 0.6);
    const before = await frame(directory, output, 0.2);
    const moved = await frame(directory, output, 1.4);

    expect(countNonRedPixels(active, 25, 25, 55, 55)).toBeGreaterThan(5);
    expect(countNonRedPixels(before, 25, 25, 55, 55)).toBe(0);
    expect(countNonRedPixels(moved, 25, 25, 55, 55)).toBe(0);
    expect(countNonRedPixels(moved, 105, 25, 135, 55)).toBeGreaterThan(5);
  });

  test('mixes delayed audio, trims it to the selected video range, and pads silence to video length', async () => {
    const directory = await makeDirectory();
    const video = await makeVideo(directory);
    const audio = path.join(directory, 'tone.wav');
    await execute(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=0.4',
      '-c:a', 'pcm_s16le', audio,
    ]);
    const project = makeProject();
    project.edits.trimStartMs = 200;
    project.edits.trimEndMs = 1_800;
    project.edits.audio = { file: audio, startMs: 600, volume: 0.5 };
    const run = makeRun(video);
    const staging = path.join(directory, 'staging');
    await mkdir(staging);
    const { audioArgs } = await buildEffects(project, run, staging);
    const output = path.join(directory, 'mixed.mp4');
    await execute(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-i', video, ...audioArgs,
      '-vf', 'trim=start=0.2:end=1.8,setpts=PTS-STARTPTS',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-map_metadata', '-1', output,
    ], { cwd: staging, windowsHide: true, timeout: 30_000 });
    const pcm = await execute(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-i', output, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', '48000', '-acodec', 'pcm_s16le', '-',
    ], { cwd: directory, encoding: 'buffer', windowsHide: true });
    const samples = new Int16Array(pcm.stdout.buffer, pcm.stdout.byteOffset, Math.floor(pcm.stdout.length / 2));
    const sourcePcm = await execute(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-i', audio, '-f', 's16le', '-ac', '1', '-ar', '48000', '-acodec', 'pcm_s16le', '-',
    ], { cwd: directory, encoding: 'buffer', windowsHide: true });
    const sourceSamples = new Int16Array(sourcePcm.stdout.buffer, sourcePcm.stdout.byteOffset, Math.floor(sourcePcm.stdout.length / 2));
    const rms = (values: Int16Array, startMs: number, endMs: number) => {
      const start = Math.floor(startMs * 48);
      const end = Math.min(values.length, Math.floor(endMs * 48));
      let sum = 0;
      for (let index = start; index < end; index += 1) sum += values[index] * values[index];
      return Math.sqrt(sum / Math.max(1, end - start));
    };
    const outputTone = rms(samples, 500, 750);
    const sourceTone = rms(sourceSamples, 100, 350);

    expect(samples.length).toBeGreaterThanOrEqual(76_000);
    expect(samples.length).toBeLessThan(80_000);
    expect(rms(samples, 80, 300)).toBeLessThan(100);
    expect(outputTone).toBeGreaterThan(sourceTone * 0.35);
    expect(outputTone).toBeLessThan(sourceTone * 0.65);
    expect(rms(samples, 1_000, 1_500)).toBeLessThan(100);
  });

  test('rejects overlapping zoom intervals before asking FFmpeg to process them', async () => {
    const directory = await makeDirectory();
    const video = await makeVideo(directory);
    const project = makeProject();
    project.edits.zooms = [
      { startMs: 100, endMs: 700, scale: 2, x: 40, y: 40 },
      { startMs: 600, endMs: 900, scale: 3, x: 80, y: 60 },
    ];

    await expect(buildEffects(project, makeRun(video), directory)).rejects.toThrow(/zoom.*overlap/i);
  });

  test('reports unsupported zoom and cursor densities instead of dropping effects', async () => {
    const directory = await makeDirectory();
    const video = await makeVideo(directory);
    const project = makeProject();
    project.edits.zooms = Array.from({ length: 65 }, (_, index) => ({
      startMs: index * 2,
      endMs: index * 2 + 1,
      scale: 2,
      x: 40,
      y: 40,
    }));
    await expect(buildEffects(project, makeRun(video), directory)).rejects.toThrow(/at most 64/i);

    project.edits.zooms = [];
    project.edits.cursorHighlight = true;
    const denseRun = makeRun(video, Array.from({ length: 20_001 }, () => ({ timeMs: 0, x: 40, y: 40 })));
    await expect(buildEffects(project, denseRun, directory)).rejects.toThrow(/at most 20000 samples/i);
  });
});
