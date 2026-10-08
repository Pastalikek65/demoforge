import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { parseProject } from '../core/project.js';
import { validateRun } from '../core/run.js';
import { buildEffects } from './effects.js';
import type { Project, RunResult, ExportOptions, ExportResult, Mask } from '../shared/types.js';

const execute = promisify(execFile);
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const escapeMD = (value: string) => value.replace(/[\\`*_{}[\]()#+.!<>|]/g, '\\$&').replace(/\r?\n/g, ' ');
function maskFilter(mask: Mask, timed: boolean): string {
  return `drawbox=x=${mask.x}:y=${mask.y}:w=${mask.width}:h=${mask.height}:color=black:t=fill${timed ? `:enable='between(t,${mask.startMs / 1000},${mask.endMs / 1000})'` : ''}`;
}
async function localFile(file: string): Promise<void> {
  if (!path.isAbsolute(file) || !(await lstat(file)).isFile()) throw new Error('Media inputs must be regular local files.');
}
async function ffmpegRun(binary: string, args: string[], cwd: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('Export canceled.');
  try { await execute(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { cwd, windowsHide: true, timeout: 600000, maxBuffer: 4 * 1024 * 1024, signal }); }
  catch { throw new Error(signal?.aborted ? 'Export canceled.' : 'FFmpeg could not process this media. Run demoforge doctor and verify the local input file.'); }
}
export async function exportRun(project: Project, run: RunResult, options: ExportOptions): Promise<ExportResult> {
  project = parseProject(project);
  run = validateRun(run, project);
  if (options.reviewed !== true) throw new Error('Review the recording and masking settings before exporting.');
  if (options.signal?.aborted) throw new Error('Export canceled.');
  if (!options.formats.length || options.formats.some(format => !['mp4', 'gif', 'markdown', 'html'].includes(format))) throw new Error('Choose supported export formats.');
  if (run.schemaVersion !== 1 || run.status !== 'passed') throw new Error('Only successful version-one runs can be exported.');
  const output = path.resolve(options.outputDir);
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  try { await lstat(output); throw new Error('Export directory already exists. Choose a new directory to preserve existing files.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const staging = await mkdtemp(path.join(parent, '.demoforge-export-'));
  const binary = options.ffmpegPath ?? process.env.DEMOFORGE_FFMPEG ?? 'ffmpeg';
  const published: string[] = [];
  const warnings = ['Raw recordings remain in the local run folder and may contain sensitive data. Review all outputs before sharing.'];
  try {
    const images: string[] = [];
    if (options.formats.includes('markdown') || options.formats.includes('html')) {
      await mkdir(path.join(staging, 'images'));
      for (const [index, step] of run.steps.entries()) {
        if (!step.screenshot) { images.push(''); continue; }
        await localFile(step.screenshot);
        const name = `images/step-${String(index + 1).padStart(3, '0')}.png`;
        // Conservatively mask every region intersecting a step, even if the screenshot was taken at its edge.
        const filters = project.edits.masks.filter(mask => mask.startMs <= step.endMs && mask.endMs >= step.startMs).map(mask => maskFilter(mask, false));
        if (project.edits.crop) { const crop = project.edits.crop; filters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`); }
        await ffmpegRun(binary, ['-i', step.screenshot, '-vf', [...filters, 'format=rgb24'].join(','), '-frames:v', '1', '-map_metadata', '-1', path.join(staging, name)], staging, options.signal);
        images.push(name); published.push(name);
      }
    }
    if (options.formats.includes('mp4') || options.formats.includes('gif')) {
      if (!run.video) throw new Error('This run has no finalized browser video.');
      await localFile(run.video);
      const start = project.edits.trimStartMs / 1000;
      const end = Math.min(project.edits.trimEndMs ?? run.durationMs, run.durationMs) / 1000;
      if (end <= start) throw new Error('Trim range falls outside the recording.');
      // Normalize BEFORE applying timed masks: upsampling after masks can repeat
      // an unmasked source frame inside a newly active redaction interval.
      const filters = ['fps=25', ...project.edits.masks.map(mask => maskFilter(mask, true))];
      const effects = await buildEffects(project, run, staging);
      filters.push(...effects.filters);
      if (project.edits.crop) {
        const crop = project.edits.crop;
        filters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
      }
      filters.push(`trim=start=${start}:end=${end}`, 'setpts=PTS-STARTPTS', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', 'format=yuv420p');
      const video = path.join(staging, 'demo.mp4');
      await ffmpegRun(binary, ['-i', run.video, ...effects.audioArgs, '-vf', filters.join(','), ...(effects.audioArgs.length ? [] : ['-an']), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-map_metadata', '-1', '-movflags', '+faststart', video], staging, options.signal);
      if (options.formats.includes('mp4')) published.push('demo.mp4');
      if (options.formats.includes('gif')) {
        await ffmpegRun(binary, ['-i', video, '-filter_complex', 'fps=12,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-map_metadata', '-1', path.join(staging, 'demo.gif')], staging, options.signal);
        published.push('demo.gif');
      }
      if (!options.formats.includes('mp4')) await rm(video);
      await rm(path.join(staging, 'cursor.ass'), { force: true });
      await rm(path.join(staging, 'annotations.ass'), { force: true });
    }
    const values = project.steps.map((step, index) => {
      const description = step.variable ? `Runtime variable: ${step.variable}` : step.action === 'fill' ? 'Text entered (review the screenshot before sharing).' : step.action === 'navigate' ? 'Open the starting page.' : step.action === 'select' ? 'Choose an option.' : '';
      const result = run.steps[index];
      const captions = project.edits.annotations.filter(item => item.startMs <= result.endMs && item.endMs >= result.startMs).map(item => item.text);
      return [description, ...captions].filter(Boolean).join(' ');
    });
    if (options.formats.includes('markdown')) {
      const content = `# ${escapeMD(project.name)}\n\nGenerated locally with DemoForge. Review before sharing.\n\n` + run.steps.map((step, index) => `## ${index + 1}. ${escapeMD(project.steps[index].name)}\n\n${escapeMD(values[index] ?? '')}\n\n${images[index] ? `![Step ${index + 1}](${images[index]})\n` : ''}`).join('\n');
      await writeFile(path.join(staging, 'guide.md'), content); published.push('guide.md');
    }
    if (options.formats.includes('html')) {
      const content = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"><title>${escapeHTML(project.name)}</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:0 24px;color:#20252a}img{max-width:100%;border:1px solid #bbb}section{margin:32px 0}</style><main><h1>${escapeHTML(project.name)}</h1><p>Generated locally with DemoForge. Review before sharing.</p>${run.steps.map((step, index) => `<section><h2>${index + 1}. ${escapeHTML(project.steps[index].name)}</h2><p>${escapeHTML(values[index] ?? '')}</p>${images[index] ? `<img src="${images[index]}" alt="Step ${index + 1}">` : ''}</section>`).join('')}</main></html>`;
      await writeFile(path.join(staging, 'guide.html'), content); published.push('guide.html');
    }
    await writeFile(path.join(staging, 'export.json'), JSON.stringify({ schemaVersion: 1, name: project.name, formats: options.formats, warnings, files: published }, null, 2));
    published.push('export.json');
    if (options.signal?.aborted) throw new Error('Export canceled.');
    await rename(staging, output);
    return { files: published.map(file => path.join(output, file)), warnings };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
