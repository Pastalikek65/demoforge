import { describe, test, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exportRun } from '../../src/media/export.js';
import type { Project, RunResult } from '../../src/shared/types.js';

const execute = promisify(execFile);
const ffmpeg = process.env.DEMOFORGE_FFMPEG ?? 'ffmpeg';
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'demoforge-media-'));
  const video = path.join(dir, 'capture.webm');
  const screenshot = path.join(dir, 'step.png');
  await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=10:d=2', '-c:v', 'libvpx', video]);
  await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', video, '-frames:v', '1', screenshot]);
  const project: Project = { schemaVersion: 1, name: '<script>alert(1)</script>', viewport: { width: 160, height: 120 }, steps: [], variables: [], edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: false } };
  project.viewport = { width: 160, height: 120 };
  project.steps = [{ id: 's1', name: 'Enter private token', action: 'fill', target: '#token', variable: 'token', timeoutMs: 1000, pauseMs: 0 }];
  project.variables = [{ name: 'token', secret: true, description: 'Runtime token' }];
  project.edits.masks = [{ id: 'm1', x: 0, y: 0, width: 80, height: 120, startMs: 0, endMs: 2000 }];
  const run: RunResult = { schemaVersion: 1, status: 'passed', projectName: project.name, startedAt: '2026-10-08T00:00:00Z', durationMs: 2000, video, cursor: [], steps: [{ id: 's1', name: 'Enter private token', status: 'passed', startMs: 0, endMs: 1000, screenshot }] };
  return { dir, project, run };
}
describe('sanitized real-media export', () => {
  test('rejects unreviewed export before writing artifacts', async () => {
    const { dir, project, run } = await fixture();
    await expect(exportRun(project, run, { outputDir: path.join(dir, 'shared'), formats: ['mp4'], reviewed: false, ffmpegPath: ffmpeg })).rejects.toThrow(/review/i);
    expect(await readdir(dir)).not.toContain('shared');
  });
  test('encodes actual MP4/GIF and irreversibly masks video and guide images', async () => {
    const { dir, project, run } = await fixture();
    const outputDir = path.join(dir, 'shared');
    const result = await exportRun(project, run, { outputDir, formats: ['mp4', 'gif', 'markdown', 'html'], reviewed: true, ffmpegPath: ffmpeg });
    expect(result.files.length).toBeGreaterThanOrEqual(4);
    for (const file of result.files) expect((await stat(file)).size).toBeGreaterThan(0);
    await execute(ffmpeg, ['-v', 'error', '-i', path.join(outputDir, 'demo.mp4'), '-f', 'null', '-']);
    await execute(ffmpeg, ['-v', 'error', '-i', path.join(outputDir, 'demo.gif'), '-f', 'null', '-']);
    const pixels = await execute(ffmpeg, ['-v', 'error', '-i', path.join(outputDir, 'demo.mp4'), '-vf', 'crop=2:2:10:10', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
    expect(Math.max(...pixels.stdout)).toBeLessThan(15);
    const imagePixels = await execute(ffmpeg, ['-v', 'error', '-i', path.join(outputDir, 'images', 'step-001.png'), '-vf', 'crop=2:2:10:10', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
    expect(Math.max(...imagePixels.stdout)).toBeLessThan(15);
    const html = await readFile(path.join(outputDir, 'guide.html'), 'utf8');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Runtime variable');
    expect(await readFile(path.join(outputDir, 'guide.md'), 'utf8')).not.toContain('capture.webm');
    expect(await readdir(outputDir)).not.toContain('capture.webm');
  });
  test('refuses to overwrite an existing directory and preserves unrelated files', async () => {
    const { dir, project, run } = await fixture();
    await writeFile(path.join(dir, 'keep.txt'), 'keep');
    await expect(exportRun(project, run, { outputDir: dir, formats: ['html'], reviewed: true, ffmpegPath: ffmpeg })).rejects.toThrow(/exist|empty/i);
    expect(await readFile(path.join(dir, 'keep.txt'), 'utf8')).toBe('keep');
  });
  test('cancellation stops processing and leaves no shareable partial directory', async () => {
    const { dir, project, run } = await fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(exportRun(project, run, { outputDir: path.join(dir, 'canceled'), formats: ['mp4'], reviewed: true, ffmpegPath: ffmpeg, signal: abort.signal })).rejects.toThrow(/cancel/i);
    expect(await readdir(dir)).not.toContain('canceled');
    expect((await readdir(dir)).filter(file => file.startsWith('.demoforge-export-'))).toEqual([]);
  });
});
