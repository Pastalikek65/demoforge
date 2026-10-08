import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import {
  captureScreenshotWithReadiness,
  SCREENSHOT_READINESS_TIMEOUT_ERROR,
} from '../../src/browser/capture.js';

type FrameWaitOptions = { timeoutMs: number; timeoutError: string };

function makePage(evaluate: () => Promise<unknown>, screenshot: (...args: unknown[]) => Promise<unknown>) {
  return {
    evaluate: vi.fn(evaluate),
    screenshot: vi.fn(screenshot),
  } as unknown as Page;
}

describe('screenshot readiness capture', () => {
  it('waits for both animation-frame callbacks before starting the screenshot', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('window', {
      requestAnimationFrame: requestFrame,
      setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
      clearTimeout: (timeout: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timeout),
    });
    try {
      const page = {
        evaluate: vi.fn(async (callback: (options: FrameWaitOptions) => Promise<void>, options: FrameWaitOptions) => callback(options)),
        screenshot: vi.fn(async () => Buffer.from('synthetic screenshot')),
      } as unknown as Page;
      const capture = captureScreenshotWithReadiness(page, { path: 'fixture.png', animations: 'disabled' });

      await Promise.resolve();
      expect(requestFrame).toHaveBeenCalledTimes(1);
      expect(page.screenshot).not.toHaveBeenCalled();
      callbacks.shift()!(0);
      expect(requestFrame).toHaveBeenCalledTimes(2);
      expect(page.screenshot).not.toHaveBeenCalled();
      callbacks.shift()!(0);
      await capture;
      expect(page.evaluate).toHaveBeenCalledTimes(1);
      expect(page.screenshot).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('bounds a page that never supplies two animation frames and does not capture', async () => {
    vi.useFakeTimers();
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('window', {
      requestAnimationFrame: requestFrame,
      setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
      clearTimeout: (timeout: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timeout),
    });
    try {
      const page = {
        evaluate: vi.fn(async (callback: (options: FrameWaitOptions) => Promise<void>, options: FrameWaitOptions) => callback(options)),
        screenshot: vi.fn(async () => Buffer.from('must not be captured')),
      } as unknown as Page;
      const capture = captureScreenshotWithReadiness(page, { path: 'fixture.png', animations: 'disabled' }, {
        totalBudgetMs: 250,
        frameWaitMs: 200,
      });
      let evaluateSettled = false;
      const evaluatePromise = vi.mocked(page.evaluate).mock.results[0]?.value as Promise<unknown>;
      void evaluatePromise.then(() => { evaluateSettled = true; }, () => { evaluateSettled = true; });
      const captureFailure = expect(capture).rejects.toThrow(SCREENSHOT_READINESS_TIMEOUT_ERROR);
      await vi.advanceTimersByTimeAsync(189);
      expect(page.screenshot).not.toHaveBeenCalled();
      expect(evaluateSettled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await captureFailure;
      expect(evaluateSettled).toBe(true);
      expect(requestFrame).toHaveBeenCalledTimes(1);
      expect(page.screenshot).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('passes only the remaining portion of the five-second screenshot budget', async () => {
    const page = makePage(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }, async () => Buffer.from('synthetic screenshot'));
    await captureScreenshotWithReadiness(page, { path: 'fixture.png', animations: 'disabled' });

    const screenshotOptions = vi.mocked(page.screenshot).mock.calls[0][0] as { timeout: number };
    expect(screenshotOptions.timeout).toBeGreaterThan(0);
    expect(screenshotOptions.timeout).toBeLessThan(5_000);
  });

  it('does not capture or replace a page-closed frame-wait failure', async () => {
    const closedPageError = new Error('The target page has closed.');
    const page = makePage(async () => { throw closedPageError; }, async () => Buffer.from('must not be captured'));
    await expect(captureScreenshotWithReadiness(page, { path: 'fixture.png', animations: 'disabled' })).rejects.toBe(closedPageError);
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it('normalizes the browser-side readiness timeout without retaining Playwright details', async () => {
    const privateDetail = 'private navigation detail';
    const playwrightError = new Error(`page.evaluate: TimeoutError: ${SCREENSHOT_READINESS_TIMEOUT_ERROR}\n    at ${privateDetail}`);
    const page = makePage(async () => { throw playwrightError; }, async () => Buffer.from('must not be captured'));
    let failure: unknown;
    try {
      await captureScreenshotWithReadiness(page, { path: 'fixture.png', animations: 'disabled' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toEqual(new Error(SCREENSHOT_READINESS_TIMEOUT_ERROR));
    expect(JSON.stringify(failure)).not.toContain(privateDetail);
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it('propagates the actual screenshot rejection after frame readiness', async () => {
    const screenshotError = new Error('Unable to capture screenshot');
    const page = makePage(async () => undefined, async () => { throw screenshotError; });
    await expect(captureScreenshotWithReadiness(page, { path: 'fixture.png', animations: 'disabled' })).rejects.toBe(screenshotError);
  });
});
