import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { verifyCaptionPixels } from '../../scripts/package-smoke.mjs';

const execute = promisify(execFile);

test('an opaque privacy mask alone cannot satisfy the packaged caption pixel check', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'demoforge-caption-evidence-'));
  const ffmpeg = process.env.DEMOFORGE_FFMPEG ?? 'ffmpeg';
  const file = path.join(directory, 'mask-without-caption.mp4');
  try {
    await execute(ffmpeg, [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=1280x720:r=25:d=0.5',
      '-vf', 'drawbox=x=280:y=80:w=720:h=580:color=black:t=fill',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file,
    ], { windowsHide: true, timeout: 15000 });
    await expect(verifyCaptionPixels(ffmpeg, file)).rejects.toThrow(/caption outline pixels/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
