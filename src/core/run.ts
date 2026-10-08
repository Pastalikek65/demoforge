import type { Project, RunResult } from '../shared/types.js';
import { z } from 'zod';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
const time = z.number().int().min(0).max(86400000);
const text = z.string().max(10000);
const report = z.object({
  schemaVersion: z.literal(1), status: z.enum(['passed', 'failed']), projectName: text,
  startedAt: z.string().datetime(), durationMs: time, video: text.optional(),
  steps: z.array(z.object({ id: text, name: text, status: z.enum(['passed', 'failed', 'not-run']), startMs: time, endMs: time, screenshot: text.optional(), error: text.optional() }).strict()).max(500),
  cursor: z.array(z.object({ timeMs: time, x: z.number().finite().min(0).max(4096), y: z.number().finite().min(0).max(4096) }).strict()).max(200000)
}).strict();
export function validateRun(input: unknown, project: Project): RunResult {
  if (!input || typeof input !== 'object' || (input as any).schemaVersion !== 1) throw new Error('Unsupported run report version. Expected version 1.');
  const parsed = report.safeParse(input);
  if (!parsed.success) throw new Error('Run report has invalid fields, timestamps or size limits.');
  const run = parsed.data;
  if (run.steps.length !== project.steps.length || run.steps.some((step, index) => step.id !== project.steps[index].id)) throw new Error('Run step IDs do not match this workflow. Replay the edited workflow first.');
  if (run.status === 'passed' && (run.steps.length === 0 || run.steps.some(step => step.status !== 'passed'))) throw new Error('A successful run must have successful step statuses.');
  if (run.steps.some(step => step.endMs < step.startMs || step.endMs > run.durationMs) || run.cursor.some(sample => sample.timeMs > run.durationMs)) throw new Error('Run report timing falls outside the recording.');
  return run;
}
export async function loadRun(file: string, project: Project): Promise<RunResult> {
  const handle = await open(file, 'r');
  let data: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 5 * 1024 * 1024) throw new Error('Run report exceeds the size limit or is not a regular file.');
    const buffer = Buffer.alloc(5 * 1024 * 1024 + 1);
    let count = 0;
    while (count < buffer.length) { const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null); if (!bytesRead) break; count += bytesRead; }
    if (count > 5 * 1024 * 1024) throw new Error('Run report exceeds the size limit.');
    data = buffer.subarray(0, count);
  } finally { await handle.close(); }
  let input: unknown;
  try { input = JSON.parse(data.toString('utf8')); } catch { throw new Error('Run report is not valid JSON.'); }
  const run = validateRun(input, project);
  const directory = await realpath(path.dirname(path.resolve(file)));
  for (const media of [run.video, ...run.steps.map(step => step.screenshot)].filter((value): value is string => Boolean(value))) {
    const relative = path.relative(directory, path.resolve(media));
    if (!path.isAbsolute(media) || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Run media is outside the capture directory.');
    const actual = path.relative(directory, await realpath(media));
    if (actual.startsWith('..') || path.isAbsolute(actual)) throw new Error('Run media resolves outside the capture directory.');
  }
  return run;
}
