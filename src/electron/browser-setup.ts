import { execFile, fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';

// Fixed vendor CLI and arguments: callers cannot select programs, URLs or flags.
async function stopInstaller(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const program = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    await new Promise<void>((resolve, reject) => execFile(program, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, error => {
      if (error) { child.kill(); reject(new Error('Installer process-tree cleanup could not be verified.')); return; }
      resolve();
    }));
  } else {
    // The fork owns a detached process group, including the vendor downloader.
    const signalGroup = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } };
    signalGroup('SIGTERM');
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
    try { process.kill(-child.pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error; }
    signalGroup('SIGKILL');
  }
}

export async function installBrowser(runtimeDirectory: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('Browser installation canceled.');
  await mkdir(runtimeDirectory, { recursive: true });
  const log = await open(path.join(runtimeDirectory, 'install.log'), 'w');
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  const environment: NodeJS.ProcessEnv = {
    ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: runtimeDirectory,
    NODE_USE_SYSTEM_CA: '1',
  };
  for (const key of Object.keys(environment)) {
    // Download fixed official binaries with verification, without inheriting
    // arbitrary Node flags or Playwright's alternate binary-host overrides.
    if (/^PLAYWRIGHT_(?:.*_)?DOWNLOAD_HOST$/i.test(key) || /^NODE_(OPTIONS|TLS_REJECT_UNAUTHORIZED)$/i.test(key)) delete environment[key];
  }
  try {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('Browser installation canceled.')); return; }
      const child = fork(cli, ['install', 'chromium'], {
        execArgv: ['--use-system-ca'], windowsHide: true,
        detached: process.platform !== 'win32',
        env: environment,
        stdio: ['ignore', log.fd, log.fd, 'ipc'],
      });
      let stopping = false;
      const finish = (error?: Error) => {
        clearTimeout(timeout); signal?.removeEventListener('abort', onAbort);
        error ? reject(error) : resolve();
      };
      const stop = (message: string) => {
        if (stopping) return;
        stopping = true; clearTimeout(timeout);
        void stopInstaller(child).then(() => finish(new Error(message)), () => finish(new Error('Browser setup cleanup failed. Check for a remaining installer process.')));
      };
      const onAbort = () => stop('Browser installation canceled.');
      const timeout = setTimeout(() => stop('Browser installation timed out. Retry with a working internet connection.'), 600_000);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      child.once('error', () => { if (!stopping) finish(new Error('Could not start browser setup.')); });
      child.once('exit', code => {
        if (!stopping) finish(code === 0 ? undefined : new Error('Browser installation failed. Check browser-runtime/install.log in the application data folder and retry.'));
      });
    });
  } finally { await log.close(); }
}
