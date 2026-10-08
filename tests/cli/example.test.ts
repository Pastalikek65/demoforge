import { test, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
test('the shipped example works through the built CLI and produces readable real outputs', async () => {
  const exampleURL = pathToFileURL(path.resolve('examples/shop/server.mjs')).href;
  const { createShop } = await import(exampleURL);
  const server = createShop();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const root = await mkdtemp(path.join(tmpdir(), 'demoforge-cli-'));
    const project = JSON.parse(await readFile('examples/shop/workflow.demoforge.json', 'utf8'));
    project.steps[0].target = `http://127.0.0.1:${server.address().port}/`;
    const file = path.join(root, 'workflow.json'); await writeFile(file, JSON.stringify(project));
    const capture = path.join(root, 'capture'); const output = path.join(root, 'output');
    await execute(process.execPath, ['dist/cli.js', 'replay', file, '--output', capture], { timeout: 30000 });
    const run = JSON.parse(await readFile(path.join(capture, 'run.json'), 'utf8'));
    expect(run.status).toBe('passed'); expect(run.steps.map((step: any) => step.status)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);
    await execute(process.execPath, ['dist/cli.js', 'export', file, '--run', path.join(capture, 'run.json'), '--output', output, '--reviewed'], { timeout: 30000 });
    const html = await readFile(path.join(output, 'guide.html'), 'utf8');
    expect(html).toContain('Create a sample notebook order');
    expect(html).toContain('images/step-005.png');
    const ffmpeg = process.env.DEMOFORGE_FFMPEG ?? 'ffmpeg';
    await execute(ffmpeg, ['-v', 'error', '-i', path.join(output, 'demo.mp4'), '-f', 'null', '-']);
    await execute(ffmpeg, ['-v', 'error', '-i', path.join(output, 'demo.gif'), '-f', 'null', '-']);
    await expect(execute(process.execPath, ['dist/cli.js', 'replay', file, '--output', capture])).rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(capture, 'run.json'), 'utf8')).status).toBe('passed');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}, 60000);
