import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { Project } from '../../src/shared/types.js';

afterEach(() => { vi.doUnmock('playwright'); vi.resetModules(); });

test.each(['replay', 'record'] as const)('%s preserves the workflow browser OS sandbox', async (operation) => {
  const launch = vi.fn().mockRejectedValue(new Error('Synthetic launch stop'));
  vi.doMock('playwright', () => ({ chromium: { launch } }));
  const { replay, startRecording } = await import('../../src/browser/runner.js');
  const directory = await mkdtemp(path.join(tmpdir(), 'demoforge-sandbox-'));
  try {
    if (operation === 'record') {
      await expect(startRecording({ url: 'http://127.0.0.1:3210/', outputDir: directory, headless: true }))
        .rejects.toThrow();
    } else {
      const workflow: Project = {
        schemaVersion: 1, name: 'Sandbox fixture', viewport: { width: 960, height: 640 }, variables: [],
        steps: [{ id: 'open', name: 'Open fixture', action: 'navigate', target: 'http://127.0.0.1:3210/', timeoutMs: 1000, pauseMs: 0 }],
        edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: false },
      };
      const result = await replay(workflow, { outputDir: directory, headless: true });
      expect(result.status).toBe('failed');
    }
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ chromiumSandbox: true }));
    // Process-title observation relies on Chromium constructing its own child
    // role switches. Workflow input must never supply browser arguments or a
    // replacement executable through these launch paths.
    const launchOptions = launch.mock.calls[0]?.[0];
    expect(launchOptions).not.toHaveProperty('args');
    expect(launchOptions).not.toHaveProperty('executablePath');
    expect(launchOptions).not.toHaveProperty('channel');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
