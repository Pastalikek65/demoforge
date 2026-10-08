import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Project } from '../../src/shared/types.js';

const directories: string[] = [];

afterEach(async () => {
  vi.doUnmock('playwright');
  vi.resetModules();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('replay startup settles cancellation while Chromium launch is pending and closes a late browser', async () => {
  vi.resetModules();
  let resolveLaunch!: (browser: unknown) => void;
  let markLaunchStarted!: () => void;
  const launchStarted = new Promise<void>((resolve) => { markLaunchStarted = resolve; });
  const launch = new Promise<unknown>((resolve) => { resolveLaunch = resolve; });
  const close = vi.fn(async () => undefined);
  const browser = { isConnected: () => true, close };
  vi.doMock('playwright', () => ({ chromium: { launch: vi.fn(() => { markLaunchStarted(); return launch; }) } }));

  const directory = await mkdtemp(path.join(tmpdir(), 'demoforge-replay-launch-'));
  directories.push(directory);
  const { replay } = await import('../../src/browser/runner.js');
  const workflow: Project = {
    schemaVersion: 1,
    name: 'Cancellation fixture',
    viewport: { width: 800, height: 600 },
    steps: [
      { id: 'open', name: 'Open fixture', action: 'navigate', target: 'http://127.0.0.1:9/', timeoutMs: 1_000, pauseMs: 0 },
      { id: 'next', name: 'Next step', action: 'wait', timeoutMs: 1_000, pauseMs: 0 },
    ],
    variables: [],
    edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: false },
  };
  const abort = new AbortController();
  const startup = replay(workflow, { outputDir: path.join(directory, 'run'), signal: abort.signal });
  await launchStarted;
  abort.abort();

  const settledBeforeLaunch = await Promise.race([
    startup.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  resolveLaunch(browser);
  const result = await startup;

  expect(settledBeforeLaunch).toBe(true);
  expect(result.steps.map((step) => step.status)).toEqual(['failed', 'not-run']);
  expect(result.steps[0].error).toContain('CANCELLED');
  expect(close).toHaveBeenCalledTimes(1);
});

test('replay closes Chromium once when launch resolves at the cancellation boundary', async () => {
  vi.resetModules();
  let resolveLaunch!: (browser: unknown) => void;
  let markLaunchStarted!: () => void;
  const launchStarted = new Promise<void>((resolve) => { markLaunchStarted = resolve; });
  const launch = new Promise<unknown>((resolve) => { resolveLaunch = resolve; });
  const close = vi.fn(async () => undefined);
  const browser = { isConnected: () => true, close };
  vi.doMock('playwright', () => ({ chromium: { launch: vi.fn(() => { markLaunchStarted(); return launch; }) } }));

  const directory = await mkdtemp(path.join(tmpdir(), 'demoforge-replay-launch-race-'));
  directories.push(directory);
  const { replay } = await import('../../src/browser/runner.js');
  const workflow: Project = {
    schemaVersion: 1,
    name: 'Cancellation fixture',
    viewport: { width: 800, height: 600 },
    steps: [{ id: 'open', name: 'Open fixture', action: 'navigate', target: 'http://127.0.0.1:9/', timeoutMs: 1_000, pauseMs: 0 }],
    variables: [],
    edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: false },
  };
  const abort = new AbortController();
  const startup = replay(workflow, { outputDir: path.join(directory, 'run'), signal: abort.signal });
  await launchStarted;
  abort.abort();
  resolveLaunch(browser);
  const result = await startup;

  expect(result.steps[0].error).toContain('CANCELLED');
  expect(close).toHaveBeenCalledTimes(1);
});
