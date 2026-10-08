import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';

// Fixed vendor CLI and arguments: callers cannot select programs, URLs or flags.
export async function installBrowser(runtimeDirectory: string): Promise<void> {
  await mkdir(runtimeDirectory, { recursive: true });
  const log = await open(path.join(runtimeDirectory, 'install.log'), 'w');
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = fork(cli, ['install', 'chromium'], {
        execArgv: [], windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: runtimeDirectory },
        stdio: ['ignore', log.fd, log.fd, 'ipc'],
      });
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Browser installation timed out. Retry with a working internet connection.')); }, 600_000);
      child.once('error', () => { clearTimeout(timeout); reject(new Error('Could not start browser setup.')); });
      child.once('exit', code => {
        clearTimeout(timeout);
        code === 0 ? resolve() : reject(new Error('Browser installation failed. Check browser-runtime/install.log in the application data folder and retry.'));
      });
    });
  } finally { await log.close(); }
}
