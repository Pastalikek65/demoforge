import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadProject } from '../../src/core/project.js';
import { loadRun } from '../../src/core/run.js';

const cliPath = path.resolve('dist/cli.js');
const secretCanary = 'CLI_PRIVATE_PASSWORD_CANARY_72b9a';
const recordPrompt = 'Perform your workflow in the browser. Press Enter here to finish.';
const recordTimeoutMs = 30_000;
const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"><title>CLI recording fixture</title></head><body>
  <form id="fixture-form">
    <label for="customer">Customer name</label><input id="customer" data-testid="customer" autocomplete="off">
    <label for="account-password">Account password</label><input id="account-password" data-testid="password" name="password" type="password" autocomplete="off">
    <label for="notebook">Notebook</label><select id="notebook" data-testid="notebook"><option value="field">Field notes</option><option value="studio">Studio journal</option></select>
    <button id="continue" data-testid="continue" type="button">Continue</button>
  </form><p id="result" hidden></p>
  <script>
    window.setTimeout(() => {
      const customer = document.querySelector('#customer');
      customer.value = 'Synthetic Customer';
      customer.dispatchEvent(new Event('input', { bubbles: true }));
      customer.dispatchEvent(new Event('change', { bubbles: true }));
      const password = document.querySelector('#account-password');
      password.value = ${JSON.stringify(secretCanary)};
      password.dispatchEvent(new Event('input', { bubbles: true }));
      password.dispatchEvent(new Event('change', { bubbles: true }));
      const notebook = document.querySelector('#notebook');
      notebook.value = 'studio';
      notebook.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#continue').click();
      const result = document.querySelector('#result');
      result.hidden = false;
      result.textContent = 'Synthetic workflow completed.';
      fetch('/actions-done', { method: 'POST', cache: 'no-store' }).catch(() => {});
    }, 900);
  </script>
</body></html>`;

type ChildOutcome = { code: number | null; signal: NodeJS.Signals | null; spawnError?: Error };
type CliProcess = {
  child: ChildProcessWithoutNullStreams;
  outcome: Promise<ChildOutcome>;
  ready: Promise<void>;
  stdout: () => string;
  stderr: () => string;
};

let ownedDirectory: string | undefined;
let fixtureServer: Server | undefined;

function launchCli(args: string[]): CliProcess {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: 'pipe',
  });
  let stdout = '';
  let stderr = '';
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    if (stdout.includes(recordPrompt)) resolveReady();
  });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const outcome = new Promise<ChildOutcome>((resolve) => {
    child.once('error', (spawnError) => resolve({ code: null, signal: null, spawnError }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, outcome, ready, stdout: () => stdout, stderr: () => stderr };
}

async function within<T>(promise: Promise<T>, deadline: number, failure: string): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(failure);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(failure)), remaining); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function beforeExit(outcome: Promise<ChildOutcome>, failure: string): Promise<never> {
  return outcome.then(() => { throw new Error(failure); });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopChildAfterFailure(session: CliProcess, safeToEnter?: Promise<boolean>, enterWasSent = false): Promise<void> {
  const alreadyClosed = await Promise.race([session.outcome.then(() => true), delay(0).then(() => false)]);
  if (alreadyClosed) return;
  if (!enterWasSent && safeToEnter) {
    const canEnter = await Promise.race([safeToEnter, session.outcome.then(() => false), delay(1_500).then(() => false)]);
    if (canEnter) await new Promise<void>((resolve) => session.child.stdin.write('\n', () => resolve())).catch(() => {});
  }
  const closedAfterGrace = await Promise.race([session.outcome.then(() => true), delay(2_000).then(() => false)]);
  if (closedAfterGrace) return;
  session.child.kill();
  await Promise.race([session.outcome, delay(2_000)]);
}

afterEach(async () => {
  if (fixtureServer) await closeServer(fixtureServer);
  fixtureServer = undefined;
  if (ownedDirectory) await rm(ownedDirectory, { recursive: true, force: true });
  ownedDirectory = undefined;
});

describe('compiled source CLI setup interfaces', () => {
  it('records a local synthetic workflow through the interactive CLI and writes parseable media-backed evidence', async () => {
    ownedDirectory = await mkdtemp(path.join(tmpdir(), 'demoforge-cli-record-'));
    let resolveActionsDone!: () => void;
    let rejectActionsDone!: (error: Error) => void;
    const actionsDone = new Promise<void>((resolve, reject) => {
      resolveActionsDone = resolve;
      rejectActionsDone = reject;
    });
    fixtureServer = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/recording') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(fixtureHtml);
        return;
      }
      if (request.method === 'POST' && request.url === '/actions-done') {
        response.writeHead(204);
        response.end();
        resolveActionsDone();
        return;
      }
      response.writeHead(404);
      response.end();
    });
    fixtureServer.once('error', rejectActionsDone);
    await new Promise<void>((resolve, reject) => {
      fixtureServer!.once('error', reject);
      fixtureServer!.listen(0, '127.0.0.1', resolve);
    });
    const address = fixtureServer.address();
    if (!address || typeof address === 'string') throw new Error('The local CLI fixture server did not bind.');

    const captureDirectory = path.join(ownedDirectory, 'capture');
    const url = `http://127.0.0.1:${address.port}/recording`;
    const deadline = Date.now() + recordTimeoutMs;
    const session = launchCli(['record', '--url', url, '--output', captureDirectory]);
    const safeToEnter = Promise.all([session.ready, actionsDone]).then(() => true, () => false);
    let enterWasSent = false;
    try {
      await within(Promise.race([session.ready, beforeExit(session.outcome, 'The record CLI exited before its ready prompt.')]), deadline, 'The record CLI did not become ready within 30 seconds.');
      await within(Promise.race([actionsDone, beforeExit(session.outcome, 'The record CLI exited before the fixture completed its actions.')]), deadline, 'The local fixture did not complete its actions within 30 seconds.');
      await new Promise<void>((resolve, reject) => session.child.stdin.write('\n', (error) => error ? reject(error) : resolve()));
      enterWasSent = true;
      const outcome = await within(session.outcome, deadline, 'The record CLI did not exit within 30 seconds after Enter.');
      expect(outcome.spawnError, 'the compiled record CLI should start through Node without a shell').toBeUndefined();
      expect(outcome.code, 'the record CLI should complete successfully').toBe(0);
      expect(session.stdout().includes('Saved 5 steps'), 'the CLI should report the recorded step count').toBe(true);
      expect(`${session.stdout()}${session.stderr()}`.includes(secretCanary), 'CLI output and errors should not contain the password canary').toBe(false);

      const projectFile = path.join(captureDirectory, 'project.demoforge.json');
      const runFile = path.join(captureDirectory, 'run.json');
      const rawProject = await readFile(projectFile, 'utf8');
      const rawRun = await readFile(runFile, 'utf8');
      expect(rawProject.includes(secretCanary), 'the project should not persist the password canary').toBe(false);
      expect(rawRun.includes(secretCanary), 'the run report should not persist the password canary').toBe(false);

      const project = await loadProject(projectFile);
      const run = await loadRun(runFile, project);
      expect(project.steps.map((step) => step.action)).toEqual(['navigate', 'fill', 'fill', 'select', 'click']);
      const passwordStep = project.steps.find((step) => step.action === 'fill' && step.target?.includes('password'));
      expect(passwordStep?.variable, 'the password step should reference a secret runtime variable').toBeTruthy();
      expect(passwordStep && Object.hasOwn(passwordStep, 'value'), 'the password step should not contain a literal value').toBe(false);
      expect(project.variables.find((variable) => variable.name === passwordStep?.variable)?.secret, 'the password variable should be marked secret').toBe(true);
      expect(run.status).toBe('passed');
      expect(run.steps.map((step) => step.status)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);

      for (const step of run.steps) {
        expect(step.screenshot, 'each recorded step should have a screenshot').toBeTruthy();
        const png = await readFile(step.screenshot!);
        expect(png.subarray(0, 8), 'each screenshot should have a PNG signature').toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      }
      expect(run.video, 'the recorded run should include its finalized video path').toBeTruthy();
      expect((await stat(run.video!)).size, 'the finalized recording video should be nonempty').toBeGreaterThan(0);
    } finally {
      await stopChildAfterFailure(session, safeToEnter, enterWasSent);
    }
  }, 45_000);

  it('returns machine-readable doctor status for runtime, Chromium and FFmpeg', async () => {
    const session = launchCli(['doctor']);
    try {
      const deadline = Date.now() + 10_000;
      const outcome = await within(session.outcome, deadline, 'The doctor CLI did not exit within 10 seconds.');
      expect(outcome.spawnError, 'the compiled doctor CLI should start through Node without a shell').toBeUndefined();
      let checks: unknown;
      try { checks = JSON.parse(session.stdout()); }
      catch { throw new Error('The doctor CLI did not return valid JSON.'); }
      expect(Array.isArray(checks), 'the doctor result should be a JSON array').toBe(true);
      const checkList = checks as { name: string; ok: boolean; detail: string }[];
      expect(checkList.map((check) => check.name)).toEqual(['Runtime', 'Chromium', 'FFmpeg']);
      expect(checkList.every((check) => typeof check.ok === 'boolean' && typeof check.detail === 'string')).toBe(true);
      expect(checkList[0]?.ok, 'the installed Node runtime should be ready').toBe(true);
      expect(checkList[1]?.ok, 'the existing local Chromium installation should be ready').toBe(true);
      if (process.env.CI === 'true' || process.env.DEMOFORGE_FFMPEG) {
        expect(checkList[2]?.ok, 'CI or the configured FFmpeg executable should be ready').toBe(true);
      }
      expect(outcome.code, 'doctor should return failure only when at least one reported check is not ready').toBe(checkList.every((check) => check.ok) ? 0 : 1);
      expect(`${session.stdout()}${session.stderr()}`.includes(secretCanary), 'doctor output should not contain the record fixture canary').toBe(false);
    } finally {
      await stopChildAfterFailure(session);
    }
  }, 15_000);
});
