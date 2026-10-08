import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directories: string[] = [];

afterEach(async () => {
  vi.doUnmock('playwright');
  vi.resetModules();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('recording startup settles cancellation while Chromium launch is still pending', async () => {
  vi.resetModules();
  let resolveLaunch!: (browser: unknown) => void;
  let markLaunchStarted!: () => void;
  const launchStarted = new Promise<void>((resolve) => { markLaunchStarted = resolve; });
  const launch = new Promise<unknown>((resolve) => { resolveLaunch = resolve; });
  const close = vi.fn(async () => undefined);
  const browser = { isConnected: () => true, close };
  vi.doMock('playwright', () => ({ chromium: { launch: vi.fn(() => { markLaunchStarted(); return launch; }) } }));

  const directory = await mkdtemp(path.join(tmpdir(), 'demoforge-release-launch-'));
  directories.push(directory);
  const { startRecording } = await import('../../src/browser/runner.js');
  const abort = new AbortController();
  const startup = startRecording({ url: 'http://127.0.0.1:1/', outputDir: path.join(directory, 'capture'), signal: abort.signal })
    .then(() => ({ ok: true, message: '' }), (error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
  await launchStarted;
  abort.abort();

  const settledBeforeLaunch = await Promise.race([
    startup.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  resolveLaunch(browser);
  const result = await startup;

  expect(settledBeforeLaunch).toBe(true);
  expect(result.ok).toBe(false);
  expect(result.message).toMatch(/cancel/i);
  expect(close).toHaveBeenCalledTimes(1);
});
