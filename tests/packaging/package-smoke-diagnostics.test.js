import { describe, expect, it } from 'vitest';
import { classifyReplayErrorCode, classifyReplayUiState, waitForReplayCompletion } from '../../scripts/package-smoke.mjs';

describe('package smoke replay diagnostics', () => {
  it('surfaces a terminal failed replay with only safe row counts', () => {
    expect(classifyReplayUiState('Failed', ['passed', { status: 'failed', errorCode: 'STEP_FAILED' }, 'not-run'], 3)).toEqual({
      state: 'failed',
      status: 'Failed',
      rowCount: 3,
      passedCount: 1,
      failedCount: 1,
      notRunCount: 1,
      failedSteps: [{ step: 2, errorCode: 'STEP_FAILED' }],
    });
  });

  it('accepts only a complete all-passed result', () => {
    expect(classifyReplayUiState('Passed', ['passed', 'passed'], 2)).toMatchObject({
      state: 'passed',
      rowCount: 2,
      passedCount: 2,
      failedCount: 0,
      notRunCount: 0,
    });
    expect(classifyReplayUiState('Passed', ['passed', 'failed'], 2).state).toBe('failed');
    expect(classifyReplayUiState('Passed', ['passed'], 2).state).toBe('pending');
  });

  it('treats a failed row as terminal evidence even while the heading has not updated', () => {
    expect(classifyReplayUiState('Private value that must not be logged', ['failed'], 2)).toMatchObject({
      state: 'failed',
      status: 'Unknown',
      rowCount: 1,
      failedCount: 1,
    });
    expect(classifyReplayUiState('Running', [{ status: 'failed', errorCode: 'STEP_FAILED' }, 'not-run'], 2)).toMatchObject({
      state: 'failed',
      status: 'Running',
      failedCount: 1,
      failedSteps: [{ step: 1, errorCode: 'STEP_FAILED' }],
    });
  });

  it('maps a failed replay row to an allowlisted code without retaining its message', () => {
    expect(classifyReplayErrorCode('STEP_FAILED: PRIVATE_RUNTIME_MARKER')).toBe('STEP_FAILED');
    expect(classifyReplayErrorCode('PRIVATE_RUNTIME_MARKER')).toBe('UNCLASSIFIED');
  });

  it('returns a terminal failed UI state promptly instead of polling to the timeout', async () => {
    const legacyPredicate = (rowCount, status, expectedCount) => rowCount === expectedCount && /Passed/.test(status);
    expect(legacyPredicate(3, 'Failed', 3)).toBe(false);

    const failedRow = {
      classList: { contains: (name) => name === 'result-row--failed' },
      querySelector: () => ({ textContent: 'STEP_FAILED: PRIVATE_RUNTIME_MARKER' }),
    };
    const passedRow = {
      classList: { contains: (name) => name === 'result-row--passed' },
      querySelector: () => null,
    };
    const notRunRow = {
      classList: { contains: (name) => name === 'result-row--not-run' },
      querySelector: () => null,
    };
    const window = {
      locator(selector) {
        if (selector === '[role="alert"]') return { count: async () => 0 };
        if (selector === '.progress-box__heading span') return { count: async () => 1, innerText: async () => 'Running' };
        if (selector === '.progress-box .result-list .result-row') {
          return { evaluateAll: async (callback) => callback([passedRow, failedRow, notRunRow]) };
        }
        throw new Error('Unexpected selector in synthetic UI fixture.');
      },
    };
    const started = Date.now();
    let failure;
    try {
      await waitForReplayCompletion(window, 3, 'synthetic replay completion', 10_000);
    } catch (error) {
      failure = error;
    }

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('heading=Running');
    expect(failure.message).toContain('failed steps=2:STEP_FAILED');
    expect(failure.message).toContain('not-run=1');
    expect(failure.message).not.toContain('PRIVATE_RUNTIME_MARKER');
  });
});
