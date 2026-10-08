import type { Page } from 'playwright';

export const SCREENSHOT_READINESS_TIMEOUT_ERROR = 'SCREENSHOT_READINESS_TIMEOUT';

const DEFAULT_SCREENSHOT_BUDGET_MS = 5_000;
const MAX_FRAME_WAIT_MS = 2_000;

export interface ReadinessScreenshotOptions {
  path: string;
  animations: 'disabled';
}

export interface ScreenshotBudget {
  totalBudgetMs?: number;
  frameWaitMs?: number;
}

function isPageReadinessTimeout(error: unknown): boolean {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return false;
  try {
    const message: unknown = Reflect.get(error, 'message');
    const prefix = `page.evaluate: TimeoutError: ${SCREENSHOT_READINESS_TIMEOUT_ERROR}`;
    return typeof message === 'string'
      && (message === prefix || message.startsWith(`${prefix}\n`) || message.startsWith(`${prefix}\r\n`));
  } catch {
    return false;
  }
}

export async function captureScreenshotWithReadiness(
  page: Page,
  options: ReadinessScreenshotOptions,
  budget: ScreenshotBudget = {},
): Promise<Buffer> {
  const totalBudgetMs = budget.totalBudgetMs ?? DEFAULT_SCREENSHOT_BUDGET_MS;
  const requestedFrameWaitMs = budget.frameWaitMs ?? MAX_FRAME_WAIT_MS;
  if (!Number.isFinite(totalBudgetMs) || totalBudgetMs <= 0
    || !Number.isFinite(requestedFrameWaitMs) || requestedFrameWaitMs < 0) {
    throw new RangeError('INVALID_SCREENSHOT_BUDGET');
  }

  const startedAt = performance.now();
  const frameWaitMs = Math.floor(Math.min(requestedFrameWaitMs, MAX_FRAME_WAIT_MS, totalBudgetMs));
  const pageFrameWaitMs = Math.max(0, frameWaitMs - Math.floor(frameWaitMs * 0.05));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const frameTimeout = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(SCREENSHOT_READINESS_TIMEOUT_ERROR)), frameWaitMs);
  });

  try {
    const waitForFrames = page.evaluate(({ timeoutMs, timeoutError }) => new Promise<void>((resolve, reject) => {
      let completed = false;
      const finish = () => {
        if (completed) return;
        completed = true;
        window.clearTimeout(pageTimeout);
        resolve();
      };
      const pageTimeout = window.setTimeout(() => {
        if (completed) return;
        completed = true;
        const error = new Error(timeoutError);
        error.name = 'TimeoutError';
        reject(error);
      }, timeoutMs);
      const requestFrame = window.requestAnimationFrame;
      requestFrame.call(window, () => {
        if (!completed) requestFrame.call(window, finish);
      });
    }), { timeoutMs: pageFrameWaitMs, timeoutError: SCREENSHOT_READINESS_TIMEOUT_ERROR });
    await Promise.race([waitForFrames, frameTimeout]);
  } catch (error) {
    if (isPageReadinessTimeout(error)) throw new Error(SCREENSHOT_READINESS_TIMEOUT_ERROR);
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }

  const remainingBudgetMs = Math.floor(totalBudgetMs - (performance.now() - startedAt));
  if (remainingBudgetMs <= 0) throw new Error(SCREENSHOT_READINESS_TIMEOUT_ERROR);

  return page.screenshot({ ...options, timeout: remainingBudgetMs });
}
