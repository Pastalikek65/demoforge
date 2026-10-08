import { createServer, type Server } from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startRecording } from '../../src/browser/runner.js';
import { serializeProject } from '../../src/core/project.js';

let server: Server | undefined;
const directories: string[] = [];

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test.each(['?access_token=', '?code=', '#access_token='])('does not persist starting URL credentials in %s', async suffix => {
  const directory = await mkdtemp(path.join(tmpdir(), 'demoforge-release-url-secret-'));
  directories.push(directory);
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Local token fixture</title>');
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Token fixture server did not bind a TCP port');

  const secret = 'SYNTHETIC_ACCESS_TOKEN_6c4a';
  const url = `http://127.0.0.1:${address.port}/callback${suffix}${secret}&state=fixture`;
  const session = await startRecording({ url, outputDir: path.join(directory, 'capture'), headless: true });
  const { project, run } = await session.stop();

  expect(project.steps[0]).toMatchObject({ action: 'navigate', variable: 'navigation_url_001' });
  expect(project.steps[0]).not.toHaveProperty('target');
  expect(project.variables).toContainEqual(expect.objectContaining({ name: 'navigation_url_001', secret: true }));
  expect(serializeProject(project)).not.toContain(secret);
  expect(JSON.stringify(run)).not.toContain(secret);
});

test('stores a sensitive URL from subsequent history navigation as a secret variable reference', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'demoforge-release-url-secret-route-'));
  directories.push(directory);
  const secret = 'SYNTHETIC_ROUTE_TOKEN_84be';
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Local route fixture</title><script>setTimeout(() => history.pushState({}, '', '/callback?access_token=${secret}&state=fixture'), 250)</script>`);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Route fixture server did not bind a TCP port');

  const outputDir = path.join(directory, 'capture');
  const session = await startRecording({ url: `http://127.0.0.1:${address.port}/start`, outputDir, headless: true });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const { project, run } = await session.stop();
  const navigationStep = project.steps.find((step) => step.action === 'navigate' && step.id !== 'step-001');

  expect(navigationStep).toMatchObject({ action: 'navigate', variable: 'navigation_url_001' });
  expect(navigationStep).not.toHaveProperty('target');
  expect(project.variables).toContainEqual(expect.objectContaining({ name: 'navigation_url_001', secret: true }));
  expect(serializeProject(project)).not.toContain(secret);
  expect(JSON.stringify(run)).not.toContain(secret);
});

test('rejects recording URLs with embedded credentials without echoing them', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'demoforge-release-url-credentials-'));
  directories.push(directory);
  const secret = 'SYNTHETIC_URL_PASSWORD_12ab';
  let visibleError = '';
  try {
    await startRecording({ url: `http://demo:${secret}@127.0.0.1:4173/`, outputDir: path.join(directory, 'capture'), headless: true });
  } catch (error) {
    visibleError = error instanceof Error ? error.message : String(error);
  }

  expect(visibleError).toMatch(/recording_url_invalid/i);
  expect(visibleError).not.toContain(secret);
});
