import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Video } from 'playwright';
import { workflowHash } from '../core/fingerprint.js';
import type { Project, RecordOptions, RecordingSession, ReplayOptions, RunResult, Step, StepResult } from '../shared/types.js';
import { hasSensitiveUrlQuery, isHttpUrl } from '../shared/url.js';
import { installCursorTracking, installRecorder, type CapturedInteraction, type CursorSample, type RecorderInstallation } from './recorder.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_LOCATOR_LENGTH = 2_048;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

function clampTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 1) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(value), MAX_TIMEOUT_MS);
}

function safeFilePart(value: string, fallback: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56);
  return safe || fallback;
}

function screenshotPath(outputDir: string, id: string, index: number): string {
  return join(outputDir, 'screenshots', `${String(index + 1).padStart(3, '0')}-${safeFilePart(id, 'step')}.png`);
}

function runResult(
  projectName: string,
  startedAt: Date,
  startedAtMs: number,
  steps: StepResult[],
  cursor: RunResult['cursor'],
  workflowFingerprint: string,
  video?: string,
): RunResult {
  return {
    schemaVersion: 1,
    status: steps.every((step) => step.status === 'passed') ? 'passed' : 'failed',
    projectName,
    workflowHash: workflowFingerprint,
    startedAt: startedAt.toISOString(),
    durationMs: Math.max(0, Date.now() - startedAtMs),
    ...(video ? { video } : {}),
    steps,
    cursor,
  };
}

function resolveStepValue(project: Project, options: ReplayOptions, step: Step): string {
  if (step.variable) {
    const variable = project.variables.find((item) => item.name === step.variable);
    if (!variable) throw new Error(`VARIABLE_UNDECLARED: ${step.variable}`);
    const value = options.variables?.[step.variable];
    if (typeof value !== 'string') throw new Error(`VARIABLE_REQUIRED: ${step.variable}`);
    return value;
  }
  if (typeof step.value !== 'string') throw new Error('VALUE_REQUIRED');
  return step.value;
}

function resolveNavigationTarget(project: Project, options: ReplayOptions, step: Step): string {
  if ((step.target === undefined) === (step.variable === undefined) || step.value !== undefined) {
    throw new Error('NAVIGATION_SOURCE_INVALID');
  }

  if (step.variable !== undefined) {
    if (!project.variables.some((item) => item.name === step.variable)) {
      throw new Error(`URL_VARIABLE_UNDECLARED: ${step.variable}`);
    }
    const value = options.variables?.[step.variable];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`URL_VARIABLE_REQUIRED: ${step.variable}`);
    }
    if (!isHttpUrl(value)) throw new Error('URL_INVALID');
    return value;
  }

  const target = step.target!;
  if (!isHttpUrl(target)) throw new Error('URL_INVALID');
  if (hasSensitiveUrlQuery(target)) throw new Error('SENSITIVE_URL_QUERY: use a runtime variable instead');
  return target;
}

async function performStep(page: Page, project: Project, options: ReplayOptions, step: Step): Promise<void> {
  const timeout = clampTimeout(step.timeoutMs);
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
  switch (step.action) {
    case 'navigate':
      await page.goto(resolveNavigationTarget(project, options, step), { waitUntil: 'domcontentloaded', timeout });
      break;
    case 'click':
      if (!step.target) throw new Error('TARGET_REQUIRED');
      await page.locator(step.target).click({ timeout });
      break;
    case 'fill':
      if (!step.target) throw new Error('TARGET_REQUIRED');
      await page.locator(step.target).fill(resolveStepValue(project, options, step), { timeout });
      break;
    case 'select':
      if (!step.target) throw new Error('TARGET_REQUIRED');
      await page.locator(step.target).selectOption(resolveStepValue(project, options, step), { timeout });
      break;
    case 'wait':
      if (step.target) await page.locator(step.target).waitFor({ state: 'visible', timeout });
      else await page.waitForTimeout(Math.max(0, Math.min(step.pauseMs, MAX_TIMEOUT_MS)));
      break;
    default:
      throw new Error('ACTION_UNSUPPORTED');
  }
  if (step.pauseMs > 0 && step.action !== 'wait') {
    await page.waitForTimeout(Math.min(step.pauseMs, MAX_TIMEOUT_MS));
  }
}

export async function replay(project: Project, options: ReplayOptions): Promise<RunResult> {
  let startedAt = new Date();
  let startedAtMs = Date.now();
  const outputDir = resolve(options.outputDir);
  const results: StepResult[] = [];
  const cursor: RunResult['cursor'] = [];
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let videoArtifact: Video | undefined;
  let contextClose: Promise<void> | undefined;
  let browserClose: Promise<void> | undefined;
  let stopForAbort: (() => void) | undefined;
  let rejectStartupCancellation!: (error: Error) => void;
  const startupCancelled = new Promise<never>((_resolve, reject) => { rejectStartupCancellation = reject; });
  void startupCancelled.catch(() => {});

  const closeContext = (): Promise<void> => {
    if (!context) return Promise.resolve();
    if (!contextClose) contextClose = context.close().catch(() => {});
    return contextClose;
  };
  const closeBrowser = (): Promise<void> => {
    if (!browser) return Promise.resolve();
    if (!browserClose) browserClose = browser.isConnected() ? browser.close().catch(() => {}) : Promise.resolve();
    return browserClose;
  };
  const notify = (result: StepResult) => {
    try { options.onProgress?.(result); } catch { /* A UI progress listener cannot change the browser result. */ }
  };
  const finishCurrent = async (step: Step, index: number, status: StepResult['status'], error?: string): Promise<StepResult> => {
    const result: StepResult = {
      id: step.id,
      name: step.name,
      status,
      startMs: (results[index]?.startMs ?? Math.max(0, Date.now() - startedAtMs)),
      endMs: Math.max(0, Date.now() - startedAtMs),
      ...(error ? { error } : {}),
    };
    let screenshotFailed = false;
    if (page && status !== 'not-run') {
      try {
        const file = screenshotPath(outputDir, step.id, index);
        await mkdir(dirname(file), { recursive: true });
        await page.screenshot({ path: file, timeout: 5_000, animations: 'disabled' });
        result.screenshot = file;
      } catch { screenshotFailed = true; }
    }
    if (status === 'passed' && options.signal?.aborted) {
      result.status = 'failed';
      result.error = `CANCELLED: ${step.id}`;
    } else if (status === 'passed' && screenshotFailed) {
      result.status = 'failed';
      result.error = `SCREENSHOT_FAILED: ${step.id}`;
    }
    results[index] = result;
    notify(result);
    return result;
  };

  try {
    await mkdir(outputDir, { recursive: true });
  } catch {
    for (let index = 0; index < project.steps.length; index += 1) {
      const step = project.steps[index];
      await finishCurrent(step, index, index === 0 ? 'failed' : 'not-run', index === 0 ? 'OUTPUT_DIRECTORY_FAILED' : undefined);
    }
    return runResult(project.name, startedAt, startedAtMs, results, cursor, workflowHash(project));
  }

  if (options.signal?.aborted) {
    for (let index = 0; index < project.steps.length; index += 1) {
      const step = project.steps[index];
      await finishCurrent(step, index, index === 0 ? 'failed' : 'not-run', index === 0 ? `CANCELLED: ${step.id}` : undefined);
    }
    return runResult(project.name, startedAt, startedAtMs, results, cursor, workflowHash(project));
  }

  try {
    stopForAbort = () => {
      rejectStartupCancellation(new Error('CANCELLED'));
      void closeContext();
      void closeBrowser();
    };
    options.signal?.addEventListener('abort', stopForAbort, { once: true });
    if (options.signal?.aborted) throw new Error('CANCELLED');
    const launch = chromium.launch({ headless: options.headless ?? true }).then(async (launchedBrowser) => {
      browser = launchedBrowser;
      if (options.signal?.aborted) {
        await closeBrowser();
        throw new Error('CANCELLED');
      }
      return launchedBrowser;
    });
    browser = await Promise.race([launch, startupCancelled]);
    if (options.signal?.aborted) throw new Error('CANCELLED');
    context = await browser.newContext({
      viewport: project.viewport,
      recordVideo: { dir: outputDir, size: project.viewport },
    });
    if (options.signal?.aborted) throw new Error('CANCELLED');
    page = await context.newPage();
    if (options.signal?.aborted) throw new Error('CANCELLED');
    startedAt = new Date();
    startedAtMs = Date.now();
    videoArtifact = page.video() ?? undefined;
    const beganAt = startedAtMs;
    await installCursorTracking(page, (sample: CursorSample) => {
      cursor.push({ timeMs: Math.max(0, Date.now() - beganAt), x: sample.x, y: sample.y });
    });
    if (options.signal?.aborted) throw new Error('CANCELLED');
    context.on('page', (newPage) => {
      if (newPage !== page) void newPage.close().catch(() => {});
    });
  } catch {
    const wasCancelled = options.signal?.aborted === true;
    if (project.steps.length) {
      for (let index = 0; index < project.steps.length; index += 1) {
        const step = project.steps[index];
        await finishCurrent(step, index, index === 0 ? 'failed' : 'not-run', index === 0
          ? wasCancelled ? `CANCELLED: ${step.id}` : 'BROWSER_LAUNCH_FAILED'
          : undefined);
      }
    }
    options.signal?.removeEventListener('abort', stopForAbort!);
    await closeContext();
    await closeBrowser();
    return runResult(project.name, startedAt, startedAtMs, results, cursor, workflowHash(project));
  }

  let failed = false;
  for (let index = 0; index < project.steps.length; index += 1) {
    const step = project.steps[index];
    const startMs = Math.max(0, Date.now() - startedAtMs);
    results[index] = { id: step.id, name: step.name, status: 'not-run', startMs, endMs: startMs };
    if (options.signal?.aborted) {
      failed = true;
      await finishCurrent(step, index, 'failed', `CANCELLED: ${step.id}`);
      break;
    }
    try {
      await performStep(page!, project, options, step);
      if (options.signal?.aborted) throw new Error('CANCELLED');
      const completedStep = await finishCurrent(step, index, 'passed');
      if (completedStep.status === 'failed') {
        failed = true;
        break;
      }
    } catch (error) {
      failed = true;
      const errorMessage = options.signal?.aborted
        ? `CANCELLED: ${step.id}`
        : error instanceof Error && /^(VARIABLE_REQUIRED|VARIABLE_UNDECLARED|URL_VARIABLE_REQUIRED|URL_VARIABLE_UNDECLARED|URL_INVALID|SENSITIVE_URL_QUERY|NAVIGATION_SOURCE_INVALID|VALUE_REQUIRED|TARGET_REQUIRED|ACTION_UNSUPPORTED)(:|$)/.test(error.message)
          ? error.message
          : `STEP_FAILED: ${step.id} (${step.action})`;
      await finishCurrent(step, index, 'failed', errorMessage);
      break;
    }
  }

  if (failed) {
    const failedIndex = results.findIndex((result) => result?.status === 'failed');
    for (let index = failedIndex + 1; index < project.steps.length; index += 1) {
      await finishCurrent(project.steps[index], index, 'not-run');
    }
  }

  options.signal?.removeEventListener('abort', stopForAbort!);
  await closeContext();
  await closeBrowser();
  let video: string | undefined;
  if (videoArtifact) {
    try { video = resolve(await videoArtifact.path()); } catch { /* The result still reports the actual step outcomes. */ }
  }
  cursor.sort((left, right) => left.timeMs - right.timeMs);
  return runResult(project.name, startedAt, startedAtMs, results, cursor, workflowHash(project), video);
}

interface RecordedStepTiming {
  startMs: number;
  endMs: number;
  screenshot?: string;
}

export async function startRecording(options: RecordOptions): Promise<RecordingSession> {
  let startedAt = new Date();
  let startedAtMs = Date.now();
  const outputDir = resolve(options.outputDir);
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  if (options.signal?.aborted) throw new Error('RECORDING_CANCELLED');
  if (!isHttpUrl(options.url)) throw new Error('RECORDING_URL_INVALID');
  try { await mkdir(outputDir, { recursive: true }); }
  catch { throw new Error('OUTPUT_DIRECTORY_FAILED'); }

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let videoArtifact: Video | undefined;
  let recorder: RecorderInstallation | undefined;
  let cancelled = false;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let abortListener: (() => void) | undefined;
  let completed: Promise<{ project: Project; run: RunResult }> | undefined;
  let interactionQueue = Promise.resolve();
  let rejectStartupCancellation!: (error: Error) => void;
  const startupCancelled = new Promise<never>((_resolve, reject) => { rejectStartupCancellation = reject; });
  void startupCancelled.catch(() => {});
  const closeResources = (): Promise<void> => {
    if (!closePromise) {
      closed = true;
      recorder?.dispose();
      if (abortListener) options.signal?.removeEventListener('abort', abortListener);
      closePromise = (async () => {
        if (context) await context.close().catch(() => {});
        if (browser?.isConnected()) await browser.close().catch(() => {});
      })();
    }
    return closePromise;
  };

  abortListener = () => {
    cancelled = true;
    rejectStartupCancellation(new Error('RECORDING_CANCELLED'));
    void closeResources();
  };
  options.signal?.addEventListener('abort', abortListener, { once: true });
  if (options.signal?.aborted) {
    abortListener();
    await closeResources();
    throw new Error('RECORDING_CANCELLED');
  }

  try {
    const launch = chromium.launch({ headless: options.headless ?? false }).then(async (launchedBrowser) => {
      browser = launchedBrowser;
      if (cancelled || options.signal?.aborted) {
        if (launchedBrowser.isConnected()) await launchedBrowser.close().catch(() => {});
        throw new Error('RECORDING_CANCELLED');
      }
      return launchedBrowser;
    });
    browser = await Promise.race([launch, startupCancelled]);
  } catch {
    const wasCancelled = cancelled || options.signal?.aborted;
    await closeResources();
    throw new Error(wasCancelled ? 'RECORDING_CANCELLED' : 'BROWSER_LAUNCH_FAILED');
  }
  if (cancelled || options.signal?.aborted) {
    await closeResources();
    throw new Error('RECORDING_CANCELLED');
  }

  try {
    context = await browser.newContext({ viewport, recordVideo: { dir: outputDir, size: viewport } });
    if (cancelled || options.signal?.aborted) {
      await context.close().catch(() => {});
      throw new Error('RECORDING_CANCELLED');
    }
    page = await context.newPage();
    if (cancelled || options.signal?.aborted) {
      await closeResources();
      throw new Error('RECORDING_CANCELLED');
    }
    startedAt = new Date();
    startedAtMs = Date.now();
    videoArtifact = page.video() ?? undefined;
  } catch {
    await closeResources();
    throw new Error(cancelled || options.signal?.aborted ? 'RECORDING_CANCELLED' : 'BROWSER_SETUP_FAILED');
  }
  const recordingPage = page!;
  context!.on('page', (newPage) => {
    if (newPage !== recordingPage) void newPage.close().catch(() => {});
  });
  const projectName = 'Recorded workflow';
  const steps: Step[] = [];
  const stepTimings: RecordedStepTiming[] = [];
  const cursor: RunResult['cursor'] = [];
  const projectVariables: Project['variables'] = [];
  let navigationVariableNumber = 0;
  const navigationFields = (url: string): Pick<Step, 'target' | 'variable'> => {
    const sensitive = hasSensitiveUrlQuery(url);
    if (sensitive || url.length > MAX_LOCATOR_LENGTH) {
      const variable = `navigation_url_${String(++navigationVariableNumber).padStart(3, '0')}`;
      projectVariables.push({
        name: variable,
        secret: sensitive,
        description: sensitive ? 'Sensitive navigation URL supplied at replay time' : 'Long navigation URL supplied at replay time',
      });
      return { variable };
    }
    return { target: url };
  };
  const initialStep: Step = {
    id: 'step-001', name: 'Open starting page', action: 'navigate', ...navigationFields(options.url),
    timeoutMs: DEFAULT_TIMEOUT_MS, pauseMs: 0,
  };
  steps.push(initialStep);
  let lastNavigation = normalizeUrl(options.url);
  const variablesByTarget = new Map<string, string>();
  let variableNumber = 0;
  let stepNumber = 1;

  const appendScreenshot = async (step: Step, index: number): Promise<RecordedStepTiming> => {
    const startMs = Math.max(0, Date.now() - startedAtMs);
    if (step.action === 'navigate') {
      try { await recordingPage.waitForLoadState('domcontentloaded', { timeout: 10_000 }); } catch { /* A document may be loading while recording begins. */ }
    }
    const file = screenshotPath(outputDir, step.id, index);
    await mkdir(dirname(file), { recursive: true });
    let screenshot: string | undefined;
    try {
      await recordingPage.screenshot({ path: file, timeout: 5_000, animations: 'disabled' });
      screenshot = file;
    } catch { /* A closed or transitioning page can still leave a valid recorded step. */ }
    return { startMs, endMs: Math.max(startMs, Date.now() - startedAtMs), ...(screenshot ? { screenshot } : {}) };
  };

  const appendInteraction = async (event: CapturedInteraction): Promise<void> => {
    if (cancelled || closed) return;
    if (!event || typeof event.target !== 'string' || !event.target.trim()) return;
    if (event.action === 'navigate') {
      if (!isHttpUrl(event.target)) return;
      const normalized = normalizeUrl(event.target);
      if (!normalized || normalized === lastNavigation) return;
      lastNavigation = normalized;
    }
    if (!['navigate', 'click', 'fill', 'select'].includes(event.action)) return;

    const id = `step-${String(++stepNumber).padStart(3, '0')}`;
    const targetFields = event.action === 'navigate'
      ? navigationFields(event.target)
      : { target: event.target.slice(0, 1_000) };
    const step: Step = {
      id,
      name: event.action === 'navigate' ? 'Navigate to page' : `${event.action[0].toUpperCase()}${event.action.slice(1)} step ${stepNumber}`,
      action: event.action,
      ...targetFields,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      pauseMs: 0,
    };
    if (event.action === 'fill' || event.action === 'select') {
      if (event.secret) {
        let variable = variablesByTarget.get(step.target!);
        if (!variable) {
          variable = `secret_${++variableNumber}`;
          variablesByTarget.set(step.target!, variable);
        }
        step.variable = variable;
        const existing = projectVariables.find((item) => item.name === variable);
        if (!existing) projectVariables.push({ name: variable, secret: true, description: 'Sensitive value supplied at replay time' });
      } else if (typeof event.value === 'string') {
        step.value = event.value;
      }
    }
    const index = steps.push(step) - 1;
    const timing = await appendScreenshot(step, index);
    stepTimings.push(timing);
  };
  const enqueueInteraction = (event: CapturedInteraction): Promise<void> => {
    interactionQueue = interactionQueue.then(() => appendInteraction(event)).catch(() => {});
    return interactionQueue;
  };

  try {
    recorder = await installRecorder(recordingPage, {
      onInteraction: enqueueInteraction,
      onCursor: (sample: CursorSample) => {
        cursor.push({ timeMs: Math.max(0, Date.now() - startedAtMs), x: sample.x, y: sample.y });
      },
    });
    if (cancelled || options.signal?.aborted) throw new Error('RECORDING_CANCELLED');
    await recordingPage.goto(options.url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
    const initialTiming = await appendScreenshot(initialStep, 0);
    stepTimings[0] = { ...initialTiming, startMs: 0 };
  } catch {
    await closeResources();
    throw new Error(cancelled || options.signal?.aborted ? 'RECORDING_CANCELLED' : 'RECORDING_START_FAILED');
  }

  return {
    stop(): Promise<{ project: Project; run: RunResult }> {
      if (cancelled) return Promise.reject(new Error('RECORDING_CANCELLED'));
      if (completed) return completed;
      completed = (async () => {
        await recorder?.flush();
        await interactionQueue;
        if (cancelled) throw new Error('RECORDING_CANCELLED');
        await closeResources();
        if (cancelled) throw new Error('RECORDING_CANCELLED');
        let video: string | undefined;
        if (videoArtifact) {
          try { video = resolve(await videoArtifact.path()); } catch { /* Video may be unavailable when Chromium exits unexpectedly. */ }
        }
        const recordedProject: Project = {
          schemaVersion: 1,
          name: projectName,
          viewport,
          steps: steps.map((step) => ({ ...step })),
          variables: projectVariables.map((variable) => ({ ...variable })),
          edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: false },
        };
        const runSteps: StepResult[] = steps.map((step, index) => ({
          id: step.id,
          name: step.name,
          status: 'passed',
          startMs: stepTimings[index]?.startMs ?? 0,
          endMs: stepTimings[index]?.endMs ?? 0,
          ...(stepTimings[index]?.screenshot ? { screenshot: stepTimings[index].screenshot } : {}),
        }));
        cursor.sort((left, right) => left.timeMs - right.timeMs);
        return { project: recordedProject, run: runResult(projectName, startedAt, startedAtMs, runSteps, cursor, workflowHash(recordedProject), video) };
      })();
      return completed;
    },
    async cancel(): Promise<void> {
      cancelled = true;
      await closeResources();
      await interactionQueue;
    },
  };
}

function normalizeUrl(value: string): string {
  try { return new URL(value).href; } catch { return value.trim(); }
}
