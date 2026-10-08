import { test, expect } from 'vitest';
import { _electron as electron } from 'playwright';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

test('the isolated desktop editor opens and its constrained bridge creates a valid project', async () => {
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ ...(process.env.DEMOFORGE_EXECUTABLE ? { executablePath: process.env.DEMOFORGE_EXECUTABLE } : {}), args: process.env.DEMOFORGE_EXECUTABLE ? [] : [path.resolve('dist/electron/main.js')], env: environment });
  try {
    const window = await application.firstWindow();
    await expect.poll(() => window.title()).toBe('DemoForge Studio');
    const boundary = await window.evaluate(() => ({ node: typeof (window as any).require, api: Object.keys((window as any).demoforge ?? {}) }));
    expect(boundary.node).toBe('undefined');
    expect(boundary.api).toContain('newProject');
    const project = await window.evaluate(() => (window as any).demoforge.newProject());
    expect(project.schemaVersion).toBe(1);
    expect(project.steps).toEqual([]);
    await expect.poll(() => window.getByRole('heading', { name: /workflow/i }).count()).toBeGreaterThan(0);
    await mkdir('artifacts/screenshots', { recursive: true });
    await window.screenshot({ path: 'artifacts/screenshots/editor.png', fullPage: true });
  } finally { await application.close(); }
}, 30000);
test('desktop replay runs in the child browser process and preview cannot read arbitrary files', async () => {
  const { createShop } = await import(pathToFileURL(path.resolve('examples/shop/server.mjs')).href);
  const server = createShop(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ ...(process.env.DEMOFORGE_EXECUTABLE ? { executablePath: process.env.DEMOFORGE_EXECUTABLE } : {}), args: process.env.DEMOFORGE_EXECUTABLE ? [] : [path.resolve('dist/electron/main.js')], env: environment });
  try {
    const window = await application.firstWindow();
    const project = JSON.parse(await readFile('examples/shop/workflow.demoforge.json', 'utf8'));
    project.steps[0].target = `http://127.0.0.1:${server.address().port}/`;
    const run = await window.evaluate(project => (window as any).demoforge.replay(project, {}), project);
    expect(run.status).toBe('passed'); expect(run.steps).toHaveLength(5);
    const preview = await window.evaluate(() => (window as any).demoforge.getPreview());
    expect(preview.video).toMatch(/^demoforge-media:\/\/capture\//);
    expect(preview.screenshots.filter(Boolean)).toHaveLength(5);
    const geometry = await window.evaluate((url: string) => new Promise<{ width: number; height: number }>((resolve, reject) => {
      const video = document.createElement('video'); video.src = url; video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight }); video.onerror = () => reject(new Error('Raw preview did not load')); document.body.append(video);
    }), preview.video);
    expect(geometry).toEqual({ width: 1280, height: 720 });
    await expect(window.evaluate(async () => (await fetch('demoforge-media://capture/../../private.png')).status)).rejects.toThrow();
    const status = await application.evaluate(async ({ net }) => (await net.fetch('demoforge-media://capture/../../private.png')).status);
    expect(status).toBe(404);
  } finally { await application.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 60000);
