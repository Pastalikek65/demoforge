import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { forkMock, execFileMock } = vi.hoisted(() => ({ forkMock: vi.fn(), execFileMock: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, fork: forkMock, execFile: execFileMock };
});

const directories: string[] = [];
let child: EventEmitter & { pid: number; connected: boolean; kill: ReturnType<typeof vi.fn> };

function emitChildExit(signal: NodeJS.Signals = 'SIGTERM') {
  child.emit('exit', null, signal);
}

function resolveTaskkill(...args: unknown[]) {
  const callback = args.at(-1);
  if (typeof callback === 'function') {
    queueMicrotask(() => {
      emitChildExit();
      (callback as (error: null, stdout: string, stderr: string) => void)(null, '', '');
    });
  }
}

function rejectTaskkill(...args: unknown[]) {
  const callback = args.at(-1);
  if (typeof callback === 'function') {
    queueMicrotask(() => (callback as (error: Error, stdout: string, stderr: string) => void)(new Error('Synthetic taskkill failure'), '', ''));
  }
}

function expectWindowsTaskkill() {
  expect(execFileMock).toHaveBeenCalledTimes(1);
  const [program, args, options, callback] = execFileMock.mock.calls[0] as [string, string[], { windowsHide: boolean; timeout: number }, Function];
  expect(program).toMatch(/[\\/]taskkill\.exe$/i);
  expect(args).toEqual(['/PID', String(child.pid), '/T', '/F']);
  expect(options).toEqual(expect.objectContaining({ windowsHide: true, timeout: 5000 }));
  expect(callback).toEqual(expect.any(Function));
}

function expectPosixProcessGroupCleanup() {
  const processKill = vi.mocked(process.kill);
  expect(processKill).toHaveBeenNthCalledWith(1, -child.pid, 'SIGTERM');
  expect(processKill).toHaveBeenNthCalledWith(2, -child.pid, 0);
  expect(processKill).toHaveBeenNthCalledWith(3, -child.pid, 'SIGKILL');
}

async function createRuntimeDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'demoforge-browser-setup-'));
  directories.push(directory);
  return directory;
}

async function withPlatform(platform: string, operation: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!descriptor?.configurable) throw new Error('This runtime does not allow an isolated platform branch test.');
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
  try { await operation(); }
  finally { Object.defineProperty(process, 'platform', descriptor); }
}

async function loadInstaller() {
  vi.resetModules();
  return import('../../src/electron/browser-setup.js');
}

beforeEach(() => {
  child = Object.assign(new EventEmitter(), {
    pid: 48271,
    connected: true,
    kill: vi.fn(() => { queueMicrotask(() => emitChildExit()); return true; }),
  });
  forkMock.mockReset().mockReturnValue(child as unknown as ChildProcess);
  execFileMock.mockReset().mockImplementation(resolveTaskkill);
  if (process.platform !== 'win32') vi.spyOn(process, 'kill').mockImplementation(() => true);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('an already-aborted setup does not start the Playwright installer', async () => {
  const runtime = await createRuntimeDirectory();
  const abort = new AbortController();
  abort.abort();
  const { installBrowser } = await loadInstaller();

  const setup = installBrowser(runtime, abort.signal);
  const outcome = await setup.then(() => 'resolved', () => 'rejected');

  expect(outcome).toBe('rejected');
  expect(forkMock).not.toHaveBeenCalled();
});

test('aborting an active setup rejects after cleaning up its installer process tree', async () => {
  const runtime = await createRuntimeDirectory();
  const abort = new AbortController();
  const { installBrowser } = await loadInstaller();
  const setup = installBrowser(runtime, abort.signal);
  await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));

  abort.abort();
  const outcome = await setup.then(() => 'resolved', () => 'rejected');

  expect(outcome).toBe('rejected');
  if (process.platform === 'win32') {
    expectWindowsTaskkill();
  } else {
    expect(forkMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ detached: true }));
    expectPosixProcessGroupCleanup();
  }
});

test.each(['win32', 'linux'] as const)('the ten-minute setup timeout cleans up the owned installer tree (%s)', async (platform) => {
  await withPlatform(platform, async () => {
    vi.useFakeTimers();
    if (platform === 'linux') vi.spyOn(process, 'kill').mockImplementation(() => true);
    const runtime = await createRuntimeDirectory();
    const { installBrowser } = await loadInstaller();
    const setup = installBrowser(runtime);
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));
    const rejected = expect(setup).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(601_001);
    await rejected;

    if (platform === 'win32') {
      expectWindowsTaskkill();
    } else {
      expectPosixProcessGroupCleanup();
    }
  });
});

test('failed Windows process-tree cleanup rejects as unverified and removes the abort listener', async () => {
  await withPlatform('win32', async () => {
    execFileMock.mockImplementation(rejectTaskkill);
    const runtime = await createRuntimeDirectory();
    const abort = new AbortController();
    const removeListener = vi.spyOn(abort.signal, 'removeEventListener');
    const { installBrowser } = await loadInstaller();
    const setup = installBrowser(runtime, abort.signal);
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));

    abort.abort();
    const outcome = await setup.then(() => ({ ok: true, error: '' }), (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/cleanup failed|remaining installer process/i);
    expectWindowsTaskkill();
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

test('POSIX abort sends SIGKILL only when the detached installer group survives the grace period', async () => {
  await withPlatform('linux', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const runtime = await createRuntimeDirectory();
    const abort = new AbortController();
    const { installBrowser } = await loadInstaller();
    const setup = installBrowser(runtime, abort.signal);
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));
    abort.abort();
    const rejected = expect(setup).rejects.toThrow(/cancel/i);

    await vi.advanceTimersByTimeAsync(1_001);
    await rejected;

    expect(forkMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ detached: true }));
    expectPosixProcessGroupCleanup();
  });
});

test('POSIX abort skips SIGKILL when the installer group exited during the grace period', async () => {
  await withPlatform('linux', async () => {
    vi.useFakeTimers();
    const processKill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
      return true;
    });
    const runtime = await createRuntimeDirectory();
    const abort = new AbortController();
    const { installBrowser } = await loadInstaller();
    const setup = installBrowser(runtime, abort.signal);
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));
    abort.abort();
    const rejected = expect(setup).rejects.toThrow(/cancel/i);

    await vi.advanceTimersByTimeAsync(1_001);
    await rejected;

    expect(processKill.mock.calls.map((call) => call[1])).toEqual(['SIGTERM', 0]);
  });
});

test('successful completion removes the setup abort listener', async () => {
  const runtime = await createRuntimeDirectory();
  const abort = new AbortController();
  const removeListener = vi.spyOn(abort.signal, 'removeEventListener');
  const { installBrowser } = await loadInstaller();
  const setup = installBrowser(runtime, abort.signal);
  await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));

  child.emit('exit', 0, null);
  await expect(setup).resolves.toBeUndefined();

  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
});

test('installer uses the fixed Playwright command and trusted TLS inputs', async () => {
  vi.stubEnv('NODE_OPTIONS', '--require C:\\synthetic\\hook.js');
  vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
  vi.stubEnv('NODE_EXTRA_CA_CERTS', 'C:\\synthetic\\company-root.pem');
  vi.stubEnv('NODE_USE_SYSTEM_CA', '0');
  vi.stubEnv('PLAYWRIGHT_DOWNLOAD_HOST', 'https://alternate.invalid');
  vi.stubEnv('PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST', 'https://alternate.invalid');
  const runtime = await createRuntimeDirectory();
  const { installBrowser } = await loadInstaller();
  const setup = installBrowser(runtime);
  await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));
  const [program, args, options] = forkMock.mock.calls[0] as [string, string[], { execArgv: string[]; env: NodeJS.ProcessEnv }];

  expect(program).toMatch(/[\\/]playwright[\\/]cli\.js$/);
  expect(args).toEqual(['install', 'chromium']);
  expect(options.execArgv).toEqual(['--use-system-ca']);
  expect(options.env.NODE_USE_SYSTEM_CA).toBe('1');
  expect(options.env.NODE_EXTRA_CA_CERTS).toBe('C:\\synthetic\\company-root.pem');
  expect(options.env.NODE_OPTIONS).toBeUndefined();
  expect(options.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  expect(options.env.PLAYWRIGHT_DOWNLOAD_HOST).toBeUndefined();
  expect(options.env.PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST).toBeUndefined();
  expect(options.env.PLAYWRIGHT_BROWSERS_PATH).toBe(runtime);
  expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1');

  child.emit('exit', 0, null);
  await expect(setup).resolves.toBeUndefined();
});
