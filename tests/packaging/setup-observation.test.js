import { describe, expect, it, vi } from 'vitest';
import { assertNoEditorAlert } from '../../scripts/package-smoke.mjs';

function makeDocument({ alerts = [], notice, setupPanel } = {}) {
  return {
    querySelectorAll: vi.fn((selector) => selector === '[role="alert"]' ? alerts : []),
    querySelector: vi.fn((selector) => {
      if (selector === '.setup-panel__notice') return notice ?? null;
      if (selector === '.setup-panel') return setupPanel ?? null;
      return null;
    }),
  };
}

async function checkSnapshot(documentStub) {
  vi.stubGlobal('document', documentStub);
  try {
    const evaluate = vi.fn(async (callback) => callback());
    const window = { evaluate, locator: vi.fn(() => { throw new Error('Setup observation must not perform a second locator read.'); }) };
    await assertNoEditorAlert(window);
    return { evaluate, locator: window.locator };
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('package smoke setup-state observation', () => {
  it('takes one DOM snapshot when the setup notice and panel disappear between separate locator reads', async () => {
    let noticePresent = true;
    const staleNotice = {
      count: vi.fn(async () => {
        const observed = noticePresent;
        noticePresent = false;
        return observed ? 1 : 0;
      }),
      innerText: vi.fn(async () => {
        if (!noticePresent) throw new Error('locator.innerText timed out after the success state removed the notice');
        return 'Downloading the local browser runtime.';
      }),
    };
    expect(await staleNotice.count()).toBe(1);
    await expect(staleNotice.innerText()).rejects.toThrow('success state removed the notice');

    const documentStub = makeDocument();
    const { evaluate, locator } = await checkSnapshot(documentStub);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(locator).not.toHaveBeenCalled();
    expect(documentStub.querySelectorAll).toHaveBeenCalledTimes(1);
    expect(documentStub.querySelector).toHaveBeenCalledTimes(2);
  });

  it('preserves the exact alert and failed-setup criteria from one snapshot', async () => {
    await expect(checkSnapshot(makeDocument({ alerts: [{ innerText: 'Fixture editor alert.' }] })))
      .rejects.toThrow('The editor reported an error: Fixture editor alert.');
    await expect(checkSnapshot(makeDocument({ notice: { innerText: 'Chromium is still unavailable.' } })))
      .rejects.toThrow('Browser setup did not make Chromium available: Chromium is still unavailable.');
    await expect(checkSnapshot(makeDocument({
      notice: { innerText: 'Browser setup finished.' },
      setupPanel: { innerText: 'Chromium requirement is missing.' },
    }))).rejects.toThrow('Browser setup completed but local requirements are still missing: Chromium requirement is missing.');
  });
});
