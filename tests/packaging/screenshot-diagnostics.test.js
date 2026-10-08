import { afterEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch: mocked.launch }, _electron: {} }));
vi.mock('../../src/browser/recorder.js', () => ({
  installCursorTracking: vi.fn(async () => {}),
  installRecorder: vi.fn(),
}));
import { classifyScreenshotFailure, formatScreenshotFailure } from '../../src/browser/runner.js';
import { classifyReplayErrorDetails, classifyReplayUiState, waitForReplayCompletion } from '../../scripts/package-smoke.mjs';
import { replay } from '../../src/browser/runner.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let outputDirectory;
afterEach(async () => {
  mocked.launch.mockReset();
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
  outputDirectory = undefined;
});

describe('sanitized screenshot failure diagnostics', () => {
  it.each([
    ['TimeoutError', 'CAPTURE', { width: 960, height: 640 }, false, 'TIMEOUT', 'PRIVATE_TIMEOUT_CANARY'],
    ['Error', 'MKDIR', { width: 960, height: 640 }, false, 'FS_EACCES', 'PRIVATE_PATH_CANARY'],
    ['Error', 'CAPTURE', { width: 960, height: 640 }, true, 'PAGE_CLOSED', 'PRIVATE_CLOSE_CANARY'],
    ['Error', 'CAPTURE', { width: 960, height: 640 }, false, 'TARGET_CRASHED', 'PRIVATE_CRASH_CANARY'],
    ['Error', 'CAPTURE', { width: 960, height: 640 }, false, 'CAPTURE_REJECTED', 'PRIVATE_CAPTURE_CANARY'],
    ['Error', 'CAPTURE', { width: 0, height: 640 }, false, 'EMPTY_VIEWPORT', 'PRIVATE_VIEWPORT_CANARY'],
    ['Error', 'CAPTURE', { width: 960, height: 640 }, false, 'OTHER', 'PRIVATE_OTHER_CANARY'],
  ])('classifies %s failures without retaining exception text', (name, operation, viewport, pageClosed, cause, marker) => {
    const message = cause === 'FS_EACCES' ? `denied at /private/path ${marker}`
      : cause === 'CAPTURE_REJECTED' ? `Unable to capture screenshot ${marker}`
        : cause === 'TARGET_CRASHED' ? `Target crashed ${marker}`
          : cause === 'TIMEOUT' ? `Timeout 5000ms exceeded. ${marker}` : marker;
    const error = new Error(message);
    error.name = name;
    if (cause === 'FS_EACCES') Object.assign(error, { code: 'EACCES' });
    const diagnostic = classifyScreenshotFailure(error, operation, pageClosed, viewport);
    expect(diagnostic).toEqual({ operation, cause, viewport: `${viewport.width}x${viewport.height}` });
    const resultError = formatScreenshotFailure('step-001', diagnostic);
    expect(resultError).toContain(`SCREENSHOT_FAILED: step-001 (operation=${operation}; cause=${cause};`);
    expect(resultError).not.toContain(marker);
    expect(resultError).not.toContain('/private/path');
    expect(classifyReplayErrorDetails(resultError)).toEqual({
      errorCode: 'SCREENSHOT_FAILED',
      screenshotDiagnostic: { operation, cause, viewport: `${viewport.width}x${viewport.height}` },
    });
  });

  it('surfaces only recognized screenshot metadata in package-smoke diagnostics', () => {
    const raw = 'SCREENSHOT_FAILED: private-step CANARY (operation=CAPTURE; cause=CAPTURE_REJECTED; viewport=960x640)';
    const details = classifyReplayErrorDetails(raw);
    expect(details).toEqual({
      errorCode: 'SCREENSHOT_FAILED',
      screenshotDiagnostic: { operation: 'CAPTURE', cause: 'CAPTURE_REJECTED', viewport: '960x640' },
    });
    expect(JSON.stringify(details)).not.toContain('private-step');
    expect(JSON.stringify(details)).not.toContain('CANARY');

    const failure = classifyReplayUiState('Running', [{ status: 'failed', ...details }, 'not-run'], 2);
    expect(failure).toMatchObject({
      state: 'failed',
      failedSteps: [{
        step: 1,
        errorCode: 'SCREENSHOT_FAILED',
        screenshotDiagnostic: { operation: 'CAPTURE', cause: 'CAPTURE_REJECTED', viewport: '960x640' },
      }],
    });
    expect(JSON.stringify(failure)).not.toContain('CANARY');
  });

  it('preserves SCREENSHOT_FAILED and withholds the injected capture exception from the run result', async () => {
    outputDirectory = await mkdtemp(join(tmpdir(), 'demoforge-screenshot-diagnostic-'));
    const page = {
      setDefaultTimeout: vi.fn(),
      setDefaultNavigationTimeout: vi.fn(),
      goto: vi.fn(async () => {}),
      isClosed: vi.fn(() => false),
      viewportSize: vi.fn(() => ({ width: 960, height: 640 })),
      video: vi.fn(() => undefined),
      screenshot: vi.fn(async () => { throw new Error('Unable to capture screenshot PRIVATE_EXCEPTION_CANARY'); }),
    };
    const context = {
      close: vi.fn(async () => {}),
      newPage: vi.fn(async () => page),
      on: vi.fn(),
    };
    const browser = {
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
      newContext: vi.fn(async () => context),
    };
    mocked.launch.mockResolvedValue(browser);
    const project = {
      schemaVersion: 1,
      name: 'Synthetic workflow',
      viewport: { width: 960, height: 640 },
      steps: [{ id: 'open', name: 'Open fixture', action: 'navigate', target: 'https://fixture.invalid', timeoutMs: 1_000, pauseMs: 0 }],
      variables: [],
      edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: false },
    };
    const progress = [];
    const result = await replay(project, { outputDir: outputDirectory, headless: false, onProgress: (step) => progress.push(step) });

    expect(result.status).toBe('failed');
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].error).toBe('SCREENSHOT_FAILED: open (operation=CAPTURE; cause=CAPTURE_REJECTED; viewport=960x640)');
    expect(JSON.stringify({ result, progress })).not.toContain('PRIVATE_EXCEPTION_CANARY');
    expect(classifyReplayErrorDetails(result.steps[0].error)).toEqual({
      errorCode: 'SCREENSHOT_FAILED',
      screenshotDiagnostic: { operation: 'CAPTURE', cause: 'CAPTURE_REJECTED', viewport: '960x640' },
    });
    expect(page.screenshot).toHaveBeenCalledTimes(1);
  });

  it('does not expose malformed screenshot details in the failed replay log', async () => {
    const raw = 'SCREENSHOT_FAILED: step-001 (operation=CAPTURE; cause=PRIVATE_CANARY; viewport=960x640)';
    const failedRow = {
      classList: { contains: (name) => name === 'result-row--failed' },
      querySelector: () => ({ textContent: raw }),
    };
    const window = {
      locator(selector) {
        if (selector === '[role="alert"]') return { count: async () => 0 };
        if (selector === '.progress-box__heading span') return { count: async () => 1, innerText: async () => 'Running' };
        if (selector === '.progress-box .result-list .result-row') return { evaluateAll: async (callback) => callback([failedRow]) };
        throw new Error('Unexpected selector in synthetic UI fixture.');
      },
    };
    let failure;
    try {
      await waitForReplayCompletion(window, 1, 'synthetic replay completion', 1_000);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('1:SCREENSHOT_FAILED');
    expect(failure.message).not.toContain('PRIVATE_CANARY');
  });
});
