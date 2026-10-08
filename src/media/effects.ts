import { lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseProject } from '../core/project.js';
import { validateRun } from '../core/run.js';
import type { Annotation, Project, RunResult } from '../shared/types.js';

const OUTPUT_FPS = 25;
const MAX_ZOOMS_PER_EXPORT = 64;
const MAX_CURSOR_SAMPLES_PER_EXPORT = 20_000;
const MAX_SUBTITLE_BYTES = 16 * 1024 * 1024;

type CursorSample = RunResult['cursor'][number];
type Zoom = Project['edits']['zooms'][number];

function numberLiteral(value: number): string {
  if (!Number.isFinite(value)) throw new Error('An editing effect contains an invalid number.');
  return String(value);
}

function assTime(milliseconds: number): string {
  const centiseconds = Math.max(0, Math.round(milliseconds / 10));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`;
}

function assHeader(width: number, height: number, style: string): string {
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n${style}\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
}

const annotationStyle = 'Style: Default,Arial,18,&H00FFFFFF,&H000000FF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,16,16,14,1';
const cursorStyle = 'Style: Cursor,Arial,28,&H00D7FF,&H000000FF,&H00D7FF,&H80000000,0,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1';

function escapeAssText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\r\n?|\n/g, '\\N');
}

function annotationEvents(annotations: Annotation[], durationMs: number): string[] {
  return annotations.flatMap((annotation) => {
    const startMs = annotation.startMs;
    const endMs = Math.min(annotation.endMs, durationMs);
    if (startMs >= durationMs || endMs <= startMs) return [];
    const start = assTime(startMs);
    const end = assTime(endMs);
    if (start === end) throw new Error('Annotations shorter than 10 ms cannot be rendered.');
    return [`Dialogue: 0,${start},${end},Default,,0,0,0,,${escapeAssText(annotation.text)}`];
  });
}

function cursorEvents(samples: CursorSample[], width: number, height: number, durationMs: number): string[] {
  if (samples.length > MAX_CURSOR_SAMPLES_PER_EXPORT) {
    throw new Error(`Cursor highlighting supports at most ${MAX_CURSOR_SAMPLES_PER_EXPORT} samples per export.`);
  }

  // Playwright writes its browser recording at 25 fps. Quantizing cursor samples to
  // those frames prevents duplicate timestamps from creating invalid ASS events.
  const byFrame = new Map<number, CursorSample>();
  for (const sample of [...samples].sort((left, right) => left.timeMs - right.timeMs)) {
    if (sample.x > width || sample.y > height) continue;
    const frame = Math.round((sample.timeMs * OUTPUT_FPS) / 1_000);
    if (frame * 1_000 / OUTPUT_FPS > durationMs) continue;
    byFrame.set(frame, sample);
  }
  const points = [...byFrame.entries()].sort((left, right) => left[0] - right[0]);
  const path = 'm 0 -14 b 8 -14 14 -8 14 0 b 14 8 8 14 0 14 b -8 14 -14 8 -14 0 b -14 -8 -8 -14 0 -14';
  return points.flatMap(([frame, sample], index) => {
    const startMs = Math.max(0, Math.round((frame * 1_000) / OUTPUT_FPS));
    const nextFrame = points[index + 1]?.[0];
    const endMs = Math.min(durationMs, nextFrame === undefined ? durationMs : Math.round((nextFrame * 1_000) / OUTPUT_FPS));
    if (endMs <= startMs) return [];
    const next = points[index + 1]?.[1] ?? sample;
    const duration = endMs - startMs;
    const start = assTime(startMs);
    const end = assTime(endMs);
    if (start === end) return [];
    const move = `\\move(${numberLiteral(Math.round(sample.x))},${numberLiteral(Math.round(sample.y))},${numberLiteral(Math.round(next.x))},${numberLiteral(Math.round(next.y))},0,${duration})`;
    const drawing = `{\\an5${move}\\p1\\1a&H70&\\1c&H00D7FF&\\3c&H00D7FF&\\bord3\\shad0}${path}{\\p0}`;
    return [`Dialogue: 0,${start},${end},Cursor,,0,0,0,,${drawing}`];
  });
}

function makeZoomFilter(zooms: Zoom[], durationMs: number, width: number, height: number): string | undefined {
  if (zooms.length > MAX_ZOOMS_PER_EXPORT) {
    throw new Error(`FFmpeg zoom effects support at most ${MAX_ZOOMS_PER_EXPORT} intervals per export.`);
  }
  const sorted = [...zooms].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startMs < sorted[index - 1].endMs) {
      throw new Error('Zoom intervals overlap. Adjust their time ranges before exporting.');
    }
  }

  const active = sorted.flatMap((zoom) => {
    const endMs = Math.min(zoom.endMs, durationMs);
    if (zoom.startMs >= durationMs || endMs <= zoom.startMs) return [];
    const firstFrame = Math.ceil((zoom.startMs * OUTPUT_FPS) / 1_000);
    const lastFrame = Math.ceil((endMs * OUTPUT_FPS) / 1_000) - 1;
    if (lastFrame < firstFrame) throw new Error('Zoom intervals shorter than one 25 fps frame cannot be rendered.');
    return [{
      firstFrame,
      lastFrame,
      scale: numberLiteral(zoom.scale),
      x: numberLiteral(zoom.x),
      y: numberLiteral(zoom.y),
    }];
  });
  if (active.length === 0) return undefined;

  let zoomExpression = '1';
  let xExpression = 'iw/2-iw/(2*zoom)';
  let yExpression = 'ih/2-ih/(2*zoom)';
  for (const zoom of active) {
    const condition = `between(in,${zoom.firstFrame},${zoom.lastFrame})`;
    const x = `max(0,min(iw-iw/zoom,${zoom.x}-iw/(2*zoom)))`;
    const y = `max(0,min(ih-ih/zoom,${zoom.y}-ih/(2*zoom)))`;
    zoomExpression = `if(${condition},${zoom.scale},${zoomExpression})`;
    xExpression = `if(${condition},${x},${xExpression})`;
    yExpression = `if(${condition},${y},${yExpression})`;
  }
  return `zoompan=z='${zoomExpression}':x='${xExpression}':y='${yExpression}':d=1:s=${width}x${height}:fps=${OUTPUT_FPS}`;
}

async function localAudioFile(file: string): Promise<void> {
  if (!path.isAbsolute(file)) throw new Error('Audio input must be a regular local file.');
  try {
    if (!(await lstat(file)).isFile()) throw new Error('not a regular file');
  } catch {
    throw new Error('Audio input must be a regular local file.');
  }
}

async function writeAss(staging: string, filename: string, contents: string): Promise<void> {
  if (Buffer.byteLength(contents, 'utf8') > MAX_SUBTITLE_BYTES) {
    throw new Error('The selected annotations and cursor samples exceed the subtitle size limit for one export.');
  }
  try {
    await writeFile(path.join(staging, filename), contents, { encoding: 'utf8', flag: 'wx' });
  } catch {
    throw new Error('Could not create the staged subtitle file for this export.');
  }
}

/**
 * Builds video filters and FFmpeg input/audio arguments for version-one edits.
 * The caller must run FFmpeg with `cwd` set to `staging`, apply masks before
 * `filters`, and apply crop/trim after them.
 */
export async function buildEffects(
  inputProject: Project,
  inputRun: RunResult,
  staging: string,
): Promise<{ filters: string[]; audioArgs: string[] }> {
  const project = parseProject(inputProject);
  const run = validateRun(inputRun, project);
  const trimStartMs = project.edits.trimStartMs;
  const trimEndMs = Math.min(project.edits.trimEndMs ?? run.durationMs, run.durationMs);
  if (trimEndMs <= trimStartMs) throw new Error('Trim range falls outside the recording.');

  const filters: string[] = [];
  const cursor = project.edits.cursorHighlight
    ? cursorEvents(run.cursor, project.viewport.width, project.viewport.height, run.durationMs)
    : [];
  if (cursor.length) {
    const contents = `${assHeader(project.viewport.width, project.viewport.height, cursorStyle)}${cursor.join('\n')}\n`;
    await writeAss(staging, 'cursor.ass', contents);
    filters.push('subtitles=filename=cursor.ass');
  }

  const zoom = makeZoomFilter(project.edits.zooms, run.durationMs, project.viewport.width, project.viewport.height);
  if (zoom) filters.push(zoom);

  const annotations = annotationEvents(project.edits.annotations, run.durationMs);
  if (annotations.length) {
    const contents = `${assHeader(project.viewport.width, project.viewport.height, annotationStyle)}${annotations.join('\n')}\n`;
    await writeAss(staging, 'annotations.ass', contents);
    filters.push('subtitles=filename=annotations.ass');
  }

  const audioArgs: string[] = [];
  if (project.edits.audio) {
    const audio = project.edits.audio;
    await localAudioFile(audio.file);
    const start = trimStartMs / 1_000;
    const end = trimEndMs / 1_000;
    const duration = (trimEndMs - trimStartMs) / 1_000;
    const audioFilter = `adelay=${audio.startMs}:all=1,atrim=start=${numberLiteral(start)}:end=${numberLiteral(end)},asetpts=PTS-STARTPTS,volume=${numberLiteral(audio.volume)},apad`;
    audioArgs.push(
      '-i', audio.file,
      '-af', audioFilter,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:a', 'aac',
      '-t', numberLiteral(duration),
    );
  }

  return { filters, audioArgs };
}
