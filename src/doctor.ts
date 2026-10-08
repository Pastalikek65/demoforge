import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
const execute = promisify(execFile);
export async function doctor(): Promise<{ name: string; ok: boolean; detail: string }[]> {
  const { chromium } = await import('playwright');
  const checks = [{ name: 'Runtime', ok: Number(process.versions.node.split('.')[0]) >= 22, detail: `Node ${process.versions.node}; ${process.platform}/${process.arch}` }];
  try { await access(chromium.executablePath()); checks.push({ name: 'Chromium', ok: true, detail: 'Browser installed locally.' }); }
  catch { checks.push({ name: 'Chromium', ok: false, detail: 'Run npm run browser:install (requires a one-time download).' }); }
  try {
    const { stdout } = await execute(process.env.DEMOFORGE_FFMPEG ?? 'ffmpeg', ['-version'], { windowsHide: true, timeout: 10000 });
    checks.push({ name: 'FFmpeg', ok: true, detail: stdout.split(/\r?\n/)[0] });
  } catch { checks.push({ name: 'FFmpeg', ok: false, detail: 'Install FFmpeg with libx264 support, or set DEMOFORGE_FFMPEG to its full executable path.' }); }
  return checks;
}
