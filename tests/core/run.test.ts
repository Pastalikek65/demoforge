import { test, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProject } from '../../src/core/project.js';
import { loadRun, validateRun } from '../../src/core/run.js';
test('run reports reject forged success and mismatched workflow step IDs', () => {
  const project = createProject('Test');
  project.steps = [{ id: 's1', name: 'Wait', action: 'wait', pauseMs: 50, timeoutMs: 1000 }];
  const run = { schemaVersion: 1, status: 'passed', projectName: 'Test', startedAt: '2026-10-08T00:00:00Z', durationMs: 500, cursor: [], steps: [{ id: 's1', name: 'Wait', status: 'passed', startMs: 0, endMs: 100 }] };
  expect(validateRun(run, project).steps[0].id).toBe('s1');
  expect(() => validateRun({ ...run, schemaVersion: 2 }, project)).toThrow(/version/i);
  expect(() => validateRun({ ...run, steps: [{ ...run.steps[0], id: 'other' }] }, project)).toThrow(/workflow|step/i);
  expect(() => validateRun({ ...run, steps: [{ ...run.steps[0], status: 'failed' }] }, project)).toThrow(/status|success/i);
  expect(() => validateRun({ ...run, durationMs: Infinity }, project)).toThrow();
  expect(() => validateRun({ ...run, cursor: [{ timeMs: 0, x: '0:evil', y: 0 }] }, project)).toThrow();
});
test('loading a run refuses media references outside its own capture directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'demoforge-report-'));
  const project = createProject('Test');
  project.steps = [{ id: 's1', name: 'Wait', action: 'wait', pauseMs: 50, timeoutMs: 1000 }];
  const report = path.join(dir, 'run.json');
  await writeFile(report, JSON.stringify({ schemaVersion: 1, status: 'passed', projectName: 'Test', startedAt: '2026-10-08T00:00:00Z', durationMs: 500, cursor: [], video: path.resolve(dir, '..', 'outside.webm'), steps: [{ id: 's1', name: 'Wait', status: 'passed', startMs: 0, endMs: 100 }] }));
  await expect(loadRun(report, project)).rejects.toThrow(/capture directory|outside/i);
  await writeFile(report, ' '.repeat(5 * 1024 * 1024 + 1));
  await expect(loadRun(report, project)).rejects.toThrow(/large|size|limit/i);
});
