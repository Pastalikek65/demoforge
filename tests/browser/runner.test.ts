import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { replay, startRecording } from '../../src/browser/runner.js';
import type { Project, ReplayOptions } from '../../src/shared/types.js';

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>DemoForge fixture</title></head>
<body>
  <label for="email">Email</label><input id="email" type="text">
  <label for="password">Password</label><input id="password" type="password">
  <label for="plan">Plan</label><select id="plan"><option value="basic">Basic</option><option value="pro">Pro</option></select>
  <button data-testid="continue">Continue</button>
  <output id="result"></output>
  <script>document.querySelector('button').addEventListener('click', () => {
    document.querySelector('#result').textContent = document.querySelector('#email').value + '|' + document.querySelector('#plan').value;
  });</script>
</body></html>`;

const recordingHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>DemoForge recording fixture</title></head>
<body>
  <label for="email">Email</label><input id="email" type="text">
  <label for="password">Password</label><input id="password" type="password">
  <label for="plan">Plan</label><select id="plan"><option value="basic">Basic</option><option value="pro">Pro</option></select>
  <button data-testid="continue">Continue</button>
  <script>setTimeout(() => {
    document.querySelector('button').click();
    const email = document.querySelector('#email'); email.value = 'fixture@example.test'; email.dispatchEvent(new Event('input', {bubbles:true})); email.dispatchEvent(new Event('change', {bubbles:true}));
    const password = document.querySelector('#password'); password.value = 'SENSITIVE_CANARY_8fd6'; password.dispatchEvent(new Event('input', {bubbles:true})); password.dispatchEvent(new Event('change', {bubbles:true}));
    const plan = document.querySelector('#plan'); plan.value = 'pro'; plan.dispatchEvent(new Event('change', {bubbles:true}));
  }, 300);</script>
</body></html>`;

let server: Server;
let baseUrl: string;
const temporaryDirectories: string[] = [];

async function makeOutputDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'demoforge-browser-'));
  temporaryDirectories.push(directory);
  return directory;
}

function project(steps: Project['steps'], overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: 1,
    name: 'Browser fixture',
    viewport: { width: 960, height: 640 },
    steps,
    variables: [],
    edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: false },
    ...overrides,
  };
}

function options(outputDir: string, extra: Partial<ReplayOptions> = {}): ReplayOptions {
  return { outputDir, headless: true, ...extra };
}

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(pageHtml);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local fixture server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('browser runner', () => {
  it('replays real page actions and writes a screenshot for each step plus finalized video', async () => {
    const outputDir = await makeOutputDirectory();
    const workflow = project([
      { id: 'open', name: 'Open fixture', action: 'navigate', target: baseUrl, timeoutMs: 5_000, pauseMs: 0 },
      { id: 'email', name: 'Enter email', action: 'fill', target: '#email', value: 'fixture@example.test', timeoutMs: 5_000, pauseMs: 0 },
      { id: 'plan', name: 'Choose plan', action: 'select', target: '#plan', value: 'pro', timeoutMs: 5_000, pauseMs: 0 },
      { id: 'continue', name: 'Continue', action: 'click', target: 'role=button[name="Continue"]', timeoutMs: 5_000, pauseMs: 0 },
      { id: 'result', name: 'Wait for result', action: 'wait', target: 'text=fixture@example.test|pro', timeoutMs: 5_000, pauseMs: 0 },
    ]);

    const result = await replay(workflow, options(outputDir));

    expect(result.status).toBe('passed');
    expect(result.steps.map((step) => step.status)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);
    expect(result.steps[0].startMs).toBeLessThan(250);
    expect(result.cursor.every((sample) => sample.timeMs <= result.durationMs)).toBe(true);
    expect(result.steps.every((step) => step.screenshot)).toBe(true);
    for (const step of result.steps) {
      const screenshot = await readFile(step.screenshot!);
      expect(screenshot.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    expect(result.video).toBeTruthy();
    expect((await stat(result.video!)).size).toBeGreaterThan(0);
    expect(result.cursor.length).toBeGreaterThan(0);
  }, 60_000);

  it('reports a changed locator by step and leaves following actions not-run', async () => {
    const outputDir = await makeOutputDirectory();
    const workflow = project([
      { id: 'open', name: 'Open fixture', action: 'navigate', target: baseUrl, timeoutMs: 5_000, pauseMs: 0 },
      { id: 'changed', name: 'Changed target', action: 'click', target: 'role=button[name="Renamed button"]', timeoutMs: 100, pauseMs: 0 },
      { id: 'later', name: 'Later action', action: 'fill', target: 'label=Email', value: 'never entered', timeoutMs: 5_000, pauseMs: 0 },
    ]);

    const result = await replay(workflow, options(outputDir));

    expect(result.status).toBe('failed');
    expect(result.steps.map((step) => step.status)).toEqual(['passed', 'failed', 'not-run']);
    expect(result.steps[1].error).toContain('STEP_FAILED');
    expect(result.steps[1].error).toContain('changed');
    expect(result.steps[1].error).not.toContain('Timeout');
    expect(result.video).toBeTruthy();
    expect((await stat(result.video!)).size).toBeGreaterThan(0);
  }, 60_000);

  it('records navigation, click, fill, and select while excluding password text from project and run data', async () => {
    const outputDir = await makeOutputDirectory();
    const recordServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(recordingHtml);
    });
    await new Promise<void>((resolve) => recordServer.listen(0, '127.0.0.1', resolve));
    const address = recordServer.address();
    if (!address || typeof address === 'string') throw new Error('Recording fixture server did not bind a TCP port');
    const recordUrl = `http://127.0.0.1:${address.port}`;

    try {
      const session = await startRecording({ url: recordUrl, outputDir, viewport: { width: 960, height: 640 }, headless: true });
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      const { project: recorded, run } = await session.stop();
      const serialized = JSON.stringify({ project: recorded, run });

      expect(recorded.steps.some((step) => step.action === 'navigate' && step.target === recordUrl)).toBe(true);
      expect(run.steps[0].startMs).toBe(0);
      expect(recorded.steps.some((step) => step.action === 'click' && step.target === '[data-testid="continue"]')).toBe(true);
      expect(recorded.steps.some((step) => step.action === 'fill' && step.value === 'fixture@example.test')).toBe(true);
      expect(recorded.steps.some((step) => step.action === 'select' && step.value === 'pro')).toBe(true);
      const passwordStep = recorded.steps.find((step) => step.variable);
      expect(passwordStep?.action).toBe('fill');
      expect(passwordStep?.value).toBeUndefined();
      expect(recorded.variables).toHaveLength(1);
      expect(recorded.variables[0]).toMatchObject({ name: passwordStep?.variable, secret: true });
      expect(serialized).not.toContain('SENSITIVE_CANARY_8fd6');
      expect(run.steps.every((step) => step.screenshot)).toBe(true);
      for (const step of run.steps) {
        const screenshot = await readFile(step.screenshot!);
        expect(screenshot.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      }
      expect(run.video).toBeTruthy();
      expect((await stat(run.video!)).size).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve, reject) => recordServer.close((error) => error ? reject(error) : resolve()));
    }
  }, 60_000);

  it('resolves runtime secret variables without including their values in run results', async () => {
    const outputDir = await makeOutputDirectory();
    const workflow = project([
      { id: 'open', name: 'Open fixture', action: 'navigate', target: baseUrl, timeoutMs: 5_000, pauseMs: 0 },
      { id: 'password', name: 'Enter password', action: 'fill', target: '#password', variable: 'login_secret', timeoutMs: 5_000, pauseMs: 0 },
    ], { variables: [{ name: 'login_secret', secret: true, description: 'Login password' }] });
    const secret = 'RUNTIME_SECRET_CANARY_6c1a';

    const result = await replay(workflow, options(outputDir, { variables: { login_secret: secret } }));

    expect(result.status).toBe('passed');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.video).toBeTruthy();
    expect((await stat(result.video!)).size).toBeGreaterThan(0);
  }, 60_000);

  it('resolves a runtime navigation URL and keeps its sensitive query out of run data', async () => {
    const outputDir = await makeOutputDirectory();
    const secret = 'NAVIGATION_RUNTIME_TOKEN_901f';
    const workflow = project([
      { id: 'open', name: 'Open private fixture', action: 'navigate', variable: 'startUrl', timeoutMs: 5_000, pauseMs: 0 },
    ], { variables: [{ name: 'startUrl', secret: true, description: 'Starting URL' }] });

    const result = await replay(workflow, options(outputDir, {
      variables: { startUrl: `${baseUrl}/?access_token=${secret}&state=fixture` },
    }));

    expect(result.status).toBe('passed');
    expect(result.steps[0].status).toBe('passed');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(workflow)).not.toContain(secret);
    expect(result.workflowHash).toMatch(/^[a-f0-9]{64}$/);
  }, 60_000);

  it('fails closed for literal sensitive navigation URLs and invalid runtime URLs', async () => {
    const secret = 'UNSAFE_LITERAL_TOKEN_70ac';
    const literal = await replay(project([
      { id: 'open', name: 'Open private fixture', action: 'navigate', target: `${baseUrl}/?access_token=${secret}`, timeoutMs: 5_000, pauseMs: 0 },
    ]), options(await makeOutputDirectory()));
    expect(literal.status).toBe('failed');
    expect(literal.steps[0].error).toContain('SENSITIVE_URL_QUERY');
    expect(JSON.stringify(literal)).not.toContain(secret);

    const credential = 'RUNTIME_URL_PASSWORD_1143';
    const invalidRuntime = await replay(project([
      { id: 'open', name: 'Open invalid fixture', action: 'navigate', variable: 'startUrl', timeoutMs: 5_000, pauseMs: 0 },
    ], { variables: [{ name: 'startUrl', secret: true, description: 'Starting URL' }] }), options(await makeOutputDirectory(), {
      variables: { startUrl: `http://demo:${credential}@127.0.0.1/` },
    }));
    expect(invalidRuntime.status).toBe('failed');
    expect(invalidRuntime.steps[0].error).toContain('URL_INVALID');
    expect(JSON.stringify(invalidRuntime)).not.toContain(credential);
  }, 60_000);

  it('cancels an in-flight wait, marks later work not-run, and releases Chromium for another run', async () => {
    const outputDir = await makeOutputDirectory();
    const controller = new AbortController();
    const workflow = project([
      { id: 'open', name: 'Open fixture', action: 'navigate', target: baseUrl, timeoutMs: 5_000, pauseMs: 0 },
      { id: 'wait', name: 'Wait for missing element', action: 'wait', target: '#never-appears', timeoutMs: 10_000, pauseMs: 0 },
      { id: 'later', name: 'Later action', action: 'click', target: '[data-testid="continue"]', timeoutMs: 5_000, pauseMs: 0 },
    ]);
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled;
    try {
      cancelled = await replay(workflow, options(outputDir, {
        signal: controller.signal,
        onProgress: (step) => {
          if (step.id === 'open' && step.status === 'passed') cancelTimer = setTimeout(() => controller.abort(), 200);
        },
      }));
    } finally {
      if (cancelTimer) clearTimeout(cancelTimer);
    }

    expect(cancelled.status).toBe('failed');
    expect(cancelled.steps.map((step) => step.status)).toEqual(['passed', 'failed', 'not-run']);
    expect(cancelled.steps[1].error).toContain('CANCELLED');
    const subsequent = await replay(project([
      { id: 'open-again', name: 'Open fixture again', action: 'navigate', target: baseUrl, timeoutMs: 5_000, pauseMs: 0 },
    ]), options(await makeOutputDirectory()));
    expect(subsequent.status).toBe('passed');
  }, 60_000);

  it('cancels a recording during slow local navigation and cleans up before a fresh recording', async () => {
    const outputDir = await makeOutputDirectory();
    let resolveRequestSeen!: () => void;
    const requestSeen = new Promise<void>((resolve) => { resolveRequestSeen = resolve; });
    let slowServer: Server;
    slowServer = createServer((_request, response) => {
      resolveRequestSeen();
      const timer = setTimeout(() => {
        if (!response.destroyed) {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end(pageHtml);
        }
      }, 10_000);
      response.on('close', () => clearTimeout(timer));
    });
    await new Promise<void>((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
    const address = slowServer.address();
    if (!address || typeof address === 'string') throw new Error('Slow fixture server did not bind a TCP port');
    const controller = new AbortController();

    try {
      const starting = startRecording({
        url: `http://127.0.0.1:${address.port}`,
        outputDir,
        viewport: { width: 960, height: 640 },
        headless: true,
        signal: controller.signal,
      });
      await requestSeen;
      controller.abort();
      await expect(starting).rejects.toMatchObject({ message: 'RECORDING_CANCELLED' });
    } finally {
      controller.abort();
      await new Promise<void>((resolve, reject) => slowServer.close((error) => error ? reject(error) : resolve()));
    }

    const session = await startRecording({ url: baseUrl, outputDir: await makeOutputDirectory(), headless: true });
    const { run } = await session.stop();
    expect(run.video).toBeTruthy();
    expect((await stat(run.video!)).size).toBeGreaterThan(0);
  }, 60_000);

  it('returns a named failure when a required runtime variable is missing', async () => {
    const outputDir = await makeOutputDirectory();
    const workflow = project([
      { id: 'open', name: 'Open fixture', action: 'navigate', target: baseUrl, timeoutMs: 5_000, pauseMs: 0 },
      { id: 'password', name: 'Enter password', action: 'fill', target: '#password', variable: 'login_secret', timeoutMs: 5_000, pauseMs: 0 },
      { id: 'later', name: 'Later action', action: 'click', target: '[data-testid="continue"]', timeoutMs: 5_000, pauseMs: 0 },
    ], { variables: [{ name: 'login_secret', secret: true, description: 'Login password' }] });

    const result = await replay(workflow, options(outputDir));

    expect(result.status).toBe('failed');
    expect(result.steps.map((step) => step.status)).toEqual(['passed', 'failed', 'not-run']);
    expect(result.steps[1].error).toContain('VARIABLE_REQUIRED');
    expect(result.steps[1].error).toContain('login_secret');
  }, 60_000);

  it('does not echo a supplied secret when the step using it fails', async () => {
    const outputDir = await makeOutputDirectory();
    const workflow = project([
      { id: 'open', name: 'Open fixture', action: 'navigate', target: baseUrl, timeoutMs: 5_000, pauseMs: 0 },
      { id: 'password', name: 'Enter password', action: 'fill', target: '#missing-password', variable: 'login_secret', timeoutMs: 100, pauseMs: 0 },
    ], { variables: [{ name: 'login_secret', secret: true, description: 'Login password' }] });
    const secret = 'FAILED_RUNTIME_SECRET_CANARY_f062';

    const result = await replay(workflow, options(outputDir, { variables: { login_secret: secret } }));

    expect(result.status).toBe('failed');
    expect(result.steps[1].error).toContain('STEP_FAILED');
    expect(JSON.stringify(result)).not.toContain(secret);
  }, 60_000);
});
