// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, RunResult, StudioAPI } from '../../src/shared/types';
import App from '../../src/renderer/App';

const project: Project = {
  schemaVersion: 1,
  name: 'Untitled workflow',
  viewport: { width: 1280, height: 720 },
  steps: [],
  variables: [],
  edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: true },
};

const run: RunResult = {
  schemaVersion: 1,
  status: 'passed',
  projectName: project.name,
  workflowHash: 'test',
  startedAt: '2026-10-08T12:00:00.000Z',
  durationMs: 0,
  steps: [],
  cursor: [],
};

function bridge(): StudioAPI {
  const api: StudioAPI = {
    newProject: vi.fn(async () => project),
    openProject: vi.fn(async () => null),
    saveProject: vi.fn(async () => 'C:\\Demos\\workflow.demo.json'),
    startRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(async () => ({ project, run })),
    replay: vi.fn(async () => run),
    export: vi.fn(async () => ({ files: [], warnings: [] })),
    cancel: vi.fn(async () => undefined),
    doctor: vi.fn(async () => [
      { name: 'Chromium', ok: false, detail: 'Choose Install browser in the editor.' },
      { name: 'FFmpeg', ok: false, detail: 'Install FFmpeg with libx264 support.' },
    ]),
    installBrowser: vi.fn(async () => [
      { name: 'Chromium', ok: true, detail: 'Browser installed locally.' },
      { name: 'FFmpeg', ok: true, detail: 'ffmpeg version 7.0' },
    ]),
    getPreview: vi.fn(async () => ({ screenshots: [] })),
    onProgress: vi.fn(() => () => undefined),
  };
  window.demoforge = api;
  return api;
}

afterEach(() => {
  cleanup();
  delete (window as Partial<Window>).demoforge;
});

describe('browser prerequisite setup', () => {
  it('shows actionable missing checks, locks the editor during installation, and confirms rechecked readiness', async () => {
    const api = bridge();
    let finishInstall: ((checks: Awaited<ReturnType<StudioAPI['installBrowser']>>) => void) | undefined;
    vi.mocked(api.installBrowser).mockImplementation(() => new Promise((resolve) => {
      finishInstall = resolve;
    }));
    render(<App />);

    expect(await screen.findByRole('region', { name: 'Local requirements' })).toHaveTextContent('Chromium: Choose Install browser in the editor.');
    expect(screen.getByRole('region', { name: 'Local requirements' })).toHaveTextContent('FFmpeg: Install FFmpeg with libx264 support.');
    fireEvent.click(screen.getByRole('button', { name: 'Install browser' }));
    await waitFor(() => expect(api.installBrowser).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Installing browser…' })).toBeDisabled();
    expect(screen.getByLabelText('Project name')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Downloading the local browser runtime.');

    finishInstall?.([
      { name: 'Chromium', ok: true, detail: 'Browser installed locally.' },
      { name: 'FFmpeg', ok: true, detail: 'ffmpeg version 7.0' },
    ]);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Browser setup finished. DemoForge checked local requirements again.'));
    expect(screen.queryByRole('region', { name: 'Local requirements' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Project name')).toBeEnabled();
  });

  it('keeps the setup panel hidden when local requirements are already ready', async () => {
    const api = bridge();
    vi.mocked(api.doctor).mockResolvedValue([
      { name: 'Chromium', ok: true, detail: 'Browser installed locally.' },
      { name: 'FFmpeg', ok: true, detail: 'ffmpeg version 7.0' },
    ]);
    render(<App />);

    await screen.findByRole('heading', { name: 'Untitled workflow' });
    await waitFor(() => expect(api.doctor).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('region', { name: 'Local requirements' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install browser' })).not.toBeInTheDocument();
  });

  it('shows a useful install failure and leaves the browser action retryable', async () => {
    const api = bridge();
    vi.mocked(api.installBrowser).mockRejectedValueOnce(new Error('download interrupted'));
    render(<App />);

    await screen.findByRole('region', { name: 'Local requirements' });
    fireEvent.click(screen.getByRole('button', { name: 'Install browser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Installing the browser failed. download interrupted');
    expect(screen.getByRole('button', { name: 'Install browser' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Install browser' }));
    await waitFor(() => expect(api.installBrowser).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Browser setup finished.'));
  });
});
