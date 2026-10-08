import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { chromium } from 'playwright';

const children: ChildProcess[] = [];
const directories: string[] = [];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.connected) child.disconnect();
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function serviceRequest(child: ChildProcess, id: number, command: string, input: unknown = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Service request '${command}' timed out`)), 35_000);
    const onMessage = (message: any) => {
      if (message?.type === 'progress' || message?.id !== id) return;
      finish(message.ok ? undefined : new Error(message.error ?? 'Service request failed.'), message);
    };
    const onExit = () => finish(new Error('Browser service exited before replying'));
    const finish = (error?: Error, result?: unknown) => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(result);
    };
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.send?.({ id, command, input }, error => {
      if (error) finish(new Error(`Could not send '${command}': ${error.message}`));
    });
  });
}

test('cancel settles record-start while its initial navigation is still loading', async () => {
  const pageRequested = deferred<void>();
  const pageReleased = deferred<void>();
  const server = createServer((_request, response) => {
    pageRequested.resolve();
    void pageReleased.promise.then(() => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>local fixture</title>');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local fixture did not bind a TCP port');

  const scratch = await mkdtemp(path.join(tmpdir(), 'demoforge-review-scratch-'));
  directories.push(scratch);
  const outputDir = path.join(scratch, 'capture');
  const home = path.join(scratch, 'home');
  await mkdir(home, { recursive: true });
  const helper = fileURLToPath(new URL('./service-child.ts', import.meta.url));
  const child = fork(helper, [], {
    execArgv: ['--import', 'tsx'],
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      DISPLAY: process.env.DISPLAY,
      XAUTHORITY: process.env.XAUTHORITY,
      TEMP: scratch,
      TMP: scratch,
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: path.join(scratch, 'appdata'),
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH
        ?? path.dirname(path.dirname(path.dirname(chromium.executablePath()))),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  children.push(child);

  const startSettled = serviceRequest(child, 1, 'record-start', {
    url: `http://127.0.0.1:${address.port}/hold`,
    outputDir,
  }).then(
    result => ({ status: 'resolved' as const, result }),
    error => ({ status: 'rejected' as const, error }),
  );
  try {
    let pageTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pageRequested.promise,
        new Promise<never>((_, reject) => { void startSettled.then(result => { if (result.status === 'rejected') reject(new Error(`Recording could not start: ${result.error.message}`)); }); }),
        new Promise<never>((_, reject) => { pageTimeout = setTimeout(() => reject(new Error('Chromium did not reach the local fixture')), 30_000); }),
      ]);
    } finally { if (pageTimeout) clearTimeout(pageTimeout); }
    await serviceRequest(child, 2, 'cancel');
    const settledAfterCancel = await Promise.race([
      startSettled.then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 750)),
    ]);

    expect(settledAfterCancel).toBe(true);
  } finally {
    pageReleased.resolve();
    await startSettled;
    if (child.connected) await serviceRequest(child, 3, 'cancel').catch(() => undefined);
    const serverClosed = once(server, 'close');
    server.close();
    await Promise.race([serverClosed, new Promise(resolve => setTimeout(resolve, 2_000))]);
  }
}, 60_000);
