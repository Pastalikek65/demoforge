import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProject, parseProject } from '../../src/core/project.js';
import { workflowHash } from '../../src/core/fingerprint.js';
import { loadRun, validateRun } from '../../src/core/run.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('rejects a run when a project with reused step IDs has changed since capture', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'demoforge-release-binding-'));
  directories.push(directory);
  const sourceProject = createProject('Shared workflow');
  sourceProject.steps = [{
    id: 'step-1', name: 'Open the billing page', action: 'navigate', target: 'https://billing.example.test', timeoutMs: 1_000, pauseMs: 0,
  }];
  sourceProject.variables = [{ name: 'accessToken', secret: true, description: 'Billing access token' }];
  const editedProject = parseProject({
    ...sourceProject,
    steps: [{ ...sourceProject.steps[0], target: 'https://attacker.example.test' }],
  });
  const reportData = {
    schemaVersion: 1,
    status: 'passed',
    projectName: sourceProject.name,
    workflowHash: workflowHash(sourceProject),
    startedAt: '2026-10-08T00:00:00Z',
    durationMs: 1_000,
    steps: [{ id: 'step-1', name: 'Open the billing page', status: 'passed', startMs: 0, endMs: 1_000 }],
    cursor: [],
  } as const;
  const video = path.join(directory, 'capture.webm');
  await writeFile(video, 'synthetic media placeholder');
  const report = path.join(directory, 'run.json');
  await writeFile(report, JSON.stringify({ ...reportData, video }));

  await expect(loadRun(report, editedProject)).rejects.toThrow(/workflow|project|fingerprint/i);

  const presentationEdits = parseProject({
    ...sourceProject,
    name: 'Renamed workflow',
    steps: [{ ...sourceProject.steps[0], name: 'Open the customer portal' }],
    variables: [{ ...sourceProject.variables[0], description: 'Used for this replay' }],
    edits: {
      ...sourceProject.edits,
      trimStartMs: 100,
      masks: [{ id: 'mask-1', x: 0, y: 0, width: 20, height: 20, startMs: 0, endMs: 1_000 }],
    },
  });
  expect(workflowHash(presentationEdits)).toBe(reportData.workflowHash);
  expect(validateRun(reportData, presentationEdits).workflowHash).toBe(reportData.workflowHash);

  const changedSecretClassification = parseProject({
    ...sourceProject,
    variables: [{ ...sourceProject.variables[0], secret: false }],
  });
  expect(workflowHash(changedSecretClassification)).not.toBe(reportData.workflowHash);
  expect(() => validateRun({ ...reportData, workflowHash: 'not-a-sha256' }, sourceProject)).toThrow(/invalid fields/i);
});

test('fingerprints every replay behavior field while ignoring step labels', () => {
  const project = createProject('Fingerprint fixture');
  project.viewport = { width: 1280, height: 720 };
  project.variables = [
    { name: 'searchTerm', secret: false, description: 'Text to search' },
    { name: 'otherTerm', secret: true, description: 'Alternative text' },
  ];
  project.steps = [
    { id: 'open', name: 'Open page', action: 'navigate', target: 'https://example.test', timeoutMs: 10_000, pauseMs: 0 },
    { id: 'search', name: 'Search', action: 'fill', target: '#search', variable: 'searchTerm', timeoutMs: 5_000, pauseMs: 100 },
  ];
  const baseline = workflowHash(project);
  const fillStep = project.steps[1];
  const { variable: _variable, ...fillWithoutVariable } = fillStep;
  const variants = [
    parseProject({ ...project, viewport: { width: 1366, height: 720 } }),
    parseProject({ ...project, steps: [{ ...project.steps[0], target: 'https://other.example.test' }, fillStep] }),
    parseProject({ ...project, steps: [{ ...project.steps[0], action: 'click', target: '#open' }, fillStep] }),
    parseProject({ ...project, steps: [project.steps[0], { ...fillWithoutVariable, value: 'literal search' }] }),
    parseProject({ ...project, steps: [project.steps[0], { ...fillStep, variable: 'otherTerm' }] }),
    parseProject({ ...project, steps: [project.steps[0], { ...fillStep, timeoutMs: 6_000 }] }),
    parseProject({ ...project, steps: [project.steps[0], { ...fillStep, pauseMs: 200 }] }),
    parseProject({ ...project, variables: project.variables.map((item) => item.name === 'searchTerm' ? { ...item, secret: true } : item) }),
    parseProject({
      ...project,
      variables: project.variables.map((item) => item.name === 'searchTerm' ? { ...item, name: 'queryText' } : item),
      steps: [project.steps[0], { ...fillStep, variable: 'queryText' }],
    }),
  ];

  for (const changed of variants) expect(workflowHash(changed)).not.toBe(baseline);

  const relabeled = parseProject({
    ...project,
    name: 'A clearer demo title',
    steps: project.steps.map((step) => ({ ...step, name: `Renamed ${step.name}` })),
    variables: project.variables.map((variable) => ({ ...variable, description: 'Presentation-only copy' })),
    edits: { ...project.edits, trimStartMs: 10, annotations: [{ id: 'note', text: 'Edited guide', startMs: 20, endMs: 80 }] },
  });
  expect(workflowHash(relabeled)).toBe(baseline);
});

test.skipIf(process.platform !== 'win32')('accepts media under a report directory when one path uses its Windows 8.3 alias', async ({ skip }) => {
  const longDirectory = await mkdtemp(path.join(tmpdir(), 'demoforge-release-alias-'));
  directories.push(longDirectory);
  const output = execFileSync('cmd.exe', ['/d'], {
    encoding: 'utf8',
    input: `@echo off\r\nfor %I in ("${longDirectory}") do @echo %~sI\r\nexit\r\n`,
  });
  const shortDirectory = output.split(/\r?\n/).reverse().map((line) => line.trim()).find((line) => /^[A-Za-z]:\\/.test(line)) ?? '';
  expect(shortDirectory).not.toBe('');
  if (path.resolve(shortDirectory).toLowerCase() === path.resolve(longDirectory).toLowerCase()) {
    skip('Windows 8.3 aliases are disabled for the temporary directory.');
  }

  const canonicalDirectory = await realpath(longDirectory);
  const project = createProject('Short and long capture paths');
  project.steps = [{ id: 'wait', name: 'Wait', action: 'wait', pauseMs: 50, timeoutMs: 1000 }];
  const video = path.join(canonicalDirectory, 'capture.webm');
  await writeFile(video, 'synthetic media placeholder');
  const report = path.join(shortDirectory, 'run.json');
  await writeFile(report, JSON.stringify({
    schemaVersion: 1,
    status: 'passed',
    projectName: project.name,
    workflowHash: workflowHash(project),
    startedAt: '2026-10-08T00:00:00Z',
    durationMs: 100,
    steps: [{ id: 'wait', name: 'Wait', status: 'passed', startMs: 0, endMs: 100 }],
    cursor: [],
    video,
  }));

  await expect(loadRun(report, project)).resolves.toMatchObject({ video });
});
