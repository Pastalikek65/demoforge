// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, RunResult, StudioAPI } from '../../src/shared/types';
import { serializeProject } from '../../src/core/project';
import App from '../../src/renderer/App';

const validProject: Project = {
  schemaVersion: 1,
  name: 'Variable edit review',
  viewport: { width: 1280, height: 720 },
  steps: [{
    id: 'fill-1', name: 'Search', action: 'fill', target: '#search', value: 'captured-literal', timeoutMs: 5_000, pauseMs: 0,
  }],
  variables: [{ name: 'searchTerm', secret: true, description: 'Search term' }],
  edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: false },
};

const emptyRun: RunResult = {
  schemaVersion: 1,
  status: 'passed',
  projectName: validProject.name,
  startedAt: '2026-10-08T00:00:00.000Z',
  durationMs: 0,
  steps: [],
  cursor: [],
};

function makeBridge(): StudioAPI {
  return {
    newProject: vi.fn(async () => validProject),
    openProject: vi.fn(async () => null),
    saveProject: vi.fn(async (project) => {
      // Exercise the same schema gate used by the real save path.
      serializeProject(project);
      return 'review.demo.json';
    }),
    startRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(async () => ({ project: validProject, run: emptyRun })),
    replay: vi.fn(async () => emptyRun),
    export: vi.fn(async () => ({ files: [], warnings: [] })),
    cancel: vi.fn(async () => undefined),
    doctor: vi.fn(async () => []),
    getPreview: vi.fn(async () => ({ screenshots: [] })),
    onProgress: vi.fn(() => () => undefined),
  };
}

afterEach(() => {
  cleanup();
  delete (window as Partial<Window>).demoforge;
});

describe('core/editor boundary review', () => {
  it('clears a literal when the user selects a runtime variable so the step remains saveable', async () => {
    const api = makeBridge();
    window.demoforge = api;
    render(<App />);

    await screen.findByRole('heading', { name: validProject.name });
    fireEvent.change(screen.getByLabelText('Runtime variable'), { target: { value: 'searchTerm' } });
    expect(screen.getByLabelText('Value')).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));

    const attemptedProject = vi.mocked(api.saveProject).mock.calls[0][0];
    expect(attemptedProject.steps[0]).toMatchObject({ variable: 'searchTerm' });
    expect(attemptedProject.steps[0]).not.toHaveProperty('value');
    expect(serializeProject(attemptedProject)).toContain('"variable": "searchTerm"');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps an invalid viewport draft local and explains the schema range before saving', async () => {
    const api = makeBridge();
    window.demoforge = api;
    render(<App />);

    await screen.findByRole('heading', { name: validProject.name });
    fireEvent.change(screen.getByLabelText('Viewport width'), { target: { value: '1' } });
    expect(screen.getByLabelText('Viewport width')).toHaveValue(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/width.*160.*4096/i);
    expect(api.saveProject).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Viewport width')).toHaveValue(1);
  });

  it('lets the user cancel pending browser startup and waits for startup to settle', async () => {
    const api = makeBridge();
    let rejectStartup: ((error: Error) => void) | undefined;
    vi.mocked(api.startRecording).mockImplementation(() => new Promise((_resolve, reject) => { rejectStartup = reject; }));
    vi.mocked(api.cancel).mockImplementation(async () => { rejectStartup?.(new Error('Recording cancelled')); });
    window.demoforge = api;
    render(<App />);

    await screen.findByRole('heading', { name: validProject.name });
    fireEvent.change(screen.getByLabelText('Starting URL'), { target: { value: 'http://127.0.0.1:4173/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await waitFor(() => expect(api.startRecording).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel current operation' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /start recording/i })).toBeEnabled());
  });

  it('keeps secret runtime input out of the project and redacts it from replay errors', async () => {
    const api = makeBridge();
    const secret = 'review-only-password-9281';
    vi.mocked(api.replay).mockResolvedValue({
      ...emptyRun,
      status: 'failed',
      steps: [{ id: 'fill-1', name: 'Search', status: 'failed', startMs: 0, endMs: 50, error: `Page reported ${secret}` }],
    });
    window.demoforge = api;
    render(<App />);

    await screen.findByRole('heading', { name: validProject.name });
    const secretInput = screen.getByLabelText('Search term');
    expect(secretInput).toHaveAttribute('type', 'password');
    fireEvent.change(secretInput, { target: { value: secret } });
    fireEvent.click(screen.getByRole('button', { name: 'Replay workflow' }));
    await waitFor(() => expect(api.replay).toHaveBeenCalledTimes(1));
    await screen.findByText(`Page reported [hidden]`);

    expect(api.replay).toHaveBeenCalledWith(validProject, { searchTerm: secret });
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Search term')).toHaveValue(''));
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    const savedJson = serializeProject(vi.mocked(api.saveProject).mock.calls[0][0]);
    expect(savedJson).not.toContain(secret);
    expect(JSON.parse(savedJson).variables).toEqual(validProject.variables);
  });

  it('finishes recording before requesting and rendering the raw preview', async () => {
    const api = makeBridge();
    const calls: string[] = [];
    const recordedRun: RunResult = {
      ...emptyRun,
      steps: [{ id: 'fill-1', name: 'Search', status: 'passed', startMs: 0, endMs: 900 }],
    };
    vi.mocked(api.startRecording).mockImplementation(async () => { calls.push('start'); });
    vi.mocked(api.stopRecording).mockImplementation(async () => {
      calls.push('stop');
      return { project: validProject, run: recordedRun };
    });
    vi.mocked(api.getPreview).mockImplementation(async () => {
      calls.push('preview');
      return {
        video: 'demoforge-media://capture/review-1/video',
        screenshots: ['demoforge-media://capture/review-1/step-0'],
      };
    });
    window.demoforge = api;
    render(<App />);

    await screen.findByRole('heading', { name: validProject.name });
    fireEvent.change(screen.getByLabelText('Starting URL'), { target: { value: 'http://127.0.0.1:4173/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await screen.findByRole('button', { name: 'Stop recording' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await screen.findByText('Recording stopped. 1 steps are ready to edit.');

    expect(calls).toEqual(['start', 'stop', 'preview']);
    expect(screen.getByLabelText('Raw replay video before masks')).toHaveAttribute('src', 'demoforge-media://capture/review-1/video');
    expect(screen.getByRole('button', { name: 'Show screenshot for Search' })).toBeInTheDocument();
  });
});
