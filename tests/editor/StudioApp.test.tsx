// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, RunResult, StepResult, StudioAPI } from '../../src/shared/types';
import { workflowHash } from '../../src/core/fingerprint';
import { parseProject } from '../../src/core/project';
import App from '../../src/renderer/App';

const projectFixture: Project = {
  schemaVersion: 1,
  name: 'Quarterly billing tour',
  viewport: { width: 1440, height: 900 },
  steps: [
    { id: 'step-1', name: 'Open the billing page', action: 'navigate', target: 'https://example.test/billing', timeoutMs: 15000, pauseMs: 500 },
    { id: 'step-2', name: 'Enter account email', action: 'fill', target: '#email', value: '{{accountEmail}}', timeoutMs: 10000, pauseMs: 300 },
    { id: 'step-3', name: 'Wait for receipt', action: 'wait', target: '#receipt', timeoutMs: 20000, pauseMs: 800 },
  ],
  variables: [
    { name: 'accountEmail', secret: false, description: 'Account email' },
    { name: 'accountPassword', secret: true, description: 'Password for this run' },
  ],
  edits: {
    trimStartMs: 0,
    masks: [],
    annotations: [],
    zooms: [],
    cursorHighlight: true,
  },
};

const runFixture: RunResult = {
  schemaVersion: 1,
  status: 'passed',
  projectName: projectFixture.name,
  workflowHash: workflowHash(projectFixture),
  startedAt: '2026-10-08T12:00:00.000Z',
  durationMs: 6200,
  steps: projectFixture.steps.map((step, index) => ({
    id: step.id,
    name: step.name,
    status: 'passed',
    startMs: index * 1800,
    endMs: (index + 1) * 1800,
  })),
  cursor: [],
};

function makeBridge(project = projectFixture) {
  const progressSubscribers = new Set<(result: StepResult) => void>();
  const api: StudioAPI = {
    newProject: vi.fn(async () => project),
    openProject: vi.fn(async () => ({ project, file: 'C:\\Demos\\quarterly-billing.demo.json' })),
    saveProject: vi.fn(async () => 'C:\\Demos\\quarterly-billing.demo.json'),
    startRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(async () => ({ project, run: runFixture })),
    replay: vi.fn(async () => runFixture),
    export: vi.fn(async () => ({ files: ['C:\\Demos\\quarterly-billing.mp4'], warnings: [] })),
    cancel: vi.fn(async () => undefined),
    doctor: vi.fn(async () => []),
    installBrowser: vi.fn(async () => []),
    getPreview: vi.fn(async () => ({
      video: 'demoforge-media://capture/revision-1/video',
      screenshots: [
        'demoforge-media://capture/revision-1/step-0',
        'demoforge-media://capture/revision-1/step-1',
        'demoforge-media://capture/revision-1/step-2',
      ],
    })),
    onProgress: vi.fn((callback) => {
      progressSubscribers.add(callback);
      return () => {
        progressSubscribers.delete(callback);
      };
    }),
  };
  return { api, progressSubscribers };
}

function renderStudio(api: StudioAPI) {
  window.demoforge = api;
  return render(<App />);
}

afterEach(() => {
  cleanup();
  delete (window as Partial<Window>).demoforge;
});

describe('DemoForge editing studio', () => {
  it('saves user edits after reordering and deleting steps', async () => {
    const { api } = makeBridge();
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    fireEvent.click(screen.getByRole('button', { name: 'Select step 3: Wait for receipt' }));
    fireEvent.change(screen.getByLabelText('Step name'), { target: { value: 'Let the receipt render' } });
    fireEvent.change(screen.getByLabelText('Locator'), { target: { value: '[data-testid="receipt"]' } });
    fireEvent.change(screen.getByLabelText('Pause after (ms)'), { target: { value: '1800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move step up' }));

    fireEvent.click(screen.getByRole('button', { name: 'Select step 3: Enter account email' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    const savedProject = vi.mocked(api.saveProject).mock.calls[0][0];
    expect(savedProject.steps.map((step) => step.name)).toEqual([
      'Open the billing page',
      'Let the receipt render',
    ]);
    expect(savedProject.steps[1]).toMatchObject({
      action: 'wait',
      target: '[data-testid="receipt"]',
      pauseMs: 1800,
    });
  });

  it('keeps literal and runtime-variable inputs mutually exclusive in strict project data', async () => {
    const { api } = makeBridge();
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    fireEvent.click(screen.getByRole('button', { name: 'Select step 2: Enter account email' }));
    expect(screen.getByLabelText('Value')).toHaveValue('{{accountEmail}}');
    fireEvent.change(screen.getByLabelText('Runtime variable'), { target: { value: 'accountEmail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    let saved = vi.mocked(api.saveProject).mock.calls[0][0];
    expect(Object.hasOwn(saved.steps[1], 'value')).toBe(false);
    expect(saved.steps[1].variable).toBe('accountEmail');
    expect(parseProject(saved)).toEqual(saved);

    vi.mocked(api.saveProject).mockClear();
    fireEvent.change(screen.getByLabelText('Runtime variable'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'new@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    saved = vi.mocked(api.saveProject).mock.calls[0][0];
    expect(Object.hasOwn(saved.steps[1], 'variable')).toBe(false);
    expect(saved.steps[1].value).toBe('new@example.test');
    expect(parseProject(saved)).toEqual(saved);
  });

  it('clears value inputs when an action changes to one that cannot accept them', async () => {
    const { api } = makeBridge();
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    fireEvent.click(screen.getByRole('button', { name: 'Select step 2: Enter account email' }));
    fireEvent.change(screen.getByLabelText('Runtime variable'), { target: { value: 'accountEmail' } });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'wait' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(api.saveProject).mock.calls[0][0];
    expect(saved.steps[1]).toMatchObject({ action: 'wait', target: '#email' });
    expect(Object.hasOwn(saved.steps[1], 'value')).toBe(false);
    expect(Object.hasOwn(saved.steps[1], 'variable')).toBe(false);
    expect(parseProject(saved)).toEqual(saved);
  });

  it('removes a URL target when changing navigation into a selector wait', async () => {
    const { api } = makeBridge();
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    fireEvent.click(screen.getByRole('button', { name: 'Select step 1: Open the billing page' }));
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'wait' } });
    expect(screen.getByLabelText('Locator')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(api.saveProject).mock.calls[0][0];
    expect(saved.steps[0]).toMatchObject({ action: 'wait' });
    expect(Object.hasOwn(saved.steps[0], 'target')).toBe(false);
    expect(parseProject(saved)).toEqual(saved);
  });

  it('keeps drafts visible and blocks save outside core name, viewport, timeout, and pause bounds', async () => {
    const { api } = makeBridge();
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    expect(screen.getByLabelText('Project name')).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText('Viewport width')).toHaveAttribute('min', '160');
    expect(screen.getByLabelText('Viewport width')).toHaveAttribute('max', '4096');
    expect(screen.getByLabelText('Viewport height')).toHaveAttribute('min', '120');
    fireEvent.click(screen.getByRole('button', { name: 'Select step 2: Enter account email' }));
    expect(screen.getByLabelText('Step name')).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText('Timeout (ms)')).toHaveAttribute('min', '1');
    expect(screen.getByLabelText('Timeout (ms)')).toHaveAttribute('max', '120000');
    expect(screen.getByLabelText('Pause after (ms)')).toHaveAttribute('min', '0');
    expect(screen.getByLabelText('Pause after (ms)')).toHaveAttribute('max', '60000');

    fireEvent.change(screen.getByLabelText('Step name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Step 2 needs a name.');
    expect(screen.getByLabelText('Step name')).toHaveValue('');
    expect(api.saveProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Step name'), { target: { value: 'Enter account email' } });
    fireEvent.change(screen.getByLabelText('Timeout (ms)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('timeout must be a whole number from 1 to 120,000 ms');
    expect(screen.getByLabelText('Timeout (ms)')).toHaveValue(0);
    expect(api.saveProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Timeout (ms)'), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText('Pause after (ms)'), { target: { value: '60001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('pause must be a whole number from 0 to 60,000 ms');
    expect(screen.getByLabelText('Pause after (ms)')).toHaveValue(60001);
    expect(api.saveProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Pause after (ms)'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('Viewport width'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Viewport width must be a whole number from 160 to 4096 pixels.');
    expect(screen.getByLabelText('Viewport width')).toHaveValue(1);
    expect(screen.getByLabelText('Viewport width')).toHaveAttribute('aria-invalid', 'true');
    expect(api.saveProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Viewport width'), { target: { value: '1920' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    expect(parseProject(vi.mocked(api.saveProject).mock.calls[0][0])).toEqual(vi.mocked(api.saveProject).mock.calls[0][0]);
  });

  it('opens a chosen project and starts a fresh project through the desktop bridge', async () => {
    const { api } = makeBridge();
    const openedProject = { ...projectFixture, name: 'Opened billing demo' };
    const freshProject: Project = { ...projectFixture, name: 'Fresh draft', steps: [], variables: [] };
    vi.mocked(api.openProject).mockResolvedValue({ project: openedProject, file: 'C:\\Demos\\opened-billing.demo.json' });
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(api.openProject).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('Project name')).toHaveValue('Opened billing demo'));

    vi.mocked(api.newProject).mockResolvedValue(freshProject);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await waitFor(() => expect(api.newProject).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('Project name')).toHaveValue('Fresh draft');
    expect(screen.getByText('No steps yet')).toBeInTheDocument();
  });

  it('sends secret runtime values to replay as password inputs without adding them to the project', async () => {
    const { api } = makeBridge();
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    const password = screen.getByLabelText('Password for this run');
    expect(password).toHaveAttribute('type', 'password');
    fireEvent.change(password, { target: { value: 'short-lived-demo-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replay workflow' }));

    await waitFor(() => expect(api.replay).toHaveBeenCalledTimes(1));
    expect(api.replay).toHaveBeenCalledWith(projectFixture, {
      accountEmail: '',
      accountPassword: 'short-lived-demo-password',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    const savedProject = vi.mocked(api.saveProject).mock.calls[0][0];
    expect(savedProject.variables).toEqual([
      { name: 'accountEmail', secret: false, description: 'Account email' },
      { name: 'accountPassword', secret: true, description: 'Password for this run' },
    ]);
    expect(JSON.stringify(savedProject)).not.toContain('short-lived-demo-password');
  });

  it('keeps export disabled until the user reviews the recording and passes that review to export', async () => {
    const { api } = makeBridge();
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    const exportButton = screen.getByRole('button', { name: 'Export selected formats' });
    expect(exportButton).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'I reviewed the recording and its redactions' }));
    expect(exportButton).toBeEnabled();
    fireEvent.click(exportButton);

    await waitFor(() => expect(api.export).toHaveBeenCalledWith(projectFixture, ['mp4'], true));
    expect(await screen.findByText(/Exported quarterly-billing\.mp4/)).toBeInTheDocument();
  });

  it('uses named replay progress and keeps the failed step error visible', async () => {
    const { api, progressSubscribers } = makeBridge();
    const rejectedRun: RunResult = {
      ...runFixture,
      status: 'failed',
      steps: [
        { ...runFixture.steps[0], status: 'passed' },
        { ...runFixture.steps[1], status: 'failed', error: 'Expected the account email field to be visible; received short-lived-demo-password.' },
        ...runFixture.steps.slice(2),
      ],
    };
    let finishReplay: ((result: RunResult) => void) | undefined;
    vi.mocked(api.replay).mockImplementation(() => {
      const failingProgress = rejectedRun.steps[1];
      for (const notify of progressSubscribers) notify(failingProgress);
      return new Promise((resolve) => {
        finishReplay = resolve;
      });
    });
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    fireEvent.change(screen.getByLabelText('Password for this run'), { target: { value: 'short-lived-demo-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replay workflow' }));

    await waitFor(() => expect(api.replay).toHaveBeenCalledTimes(1));
    const progressRegion = screen.getByRole('region', { name: 'Replay progress' });
    expect(within(progressRegion).getByText('Enter account email')).toBeInTheDocument();
    expect(within(progressRegion).getByText('Expected the account email field to be visible; received [hidden].')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replaying…' })).toBeDisabled();
    expect(finishReplay).toBeDefined();
    finishReplay?.(rejectedRun);
    await waitFor(() => expect(within(progressRegion).getAllByText('Failed').length).toBeGreaterThan(0));
    expect(screen.queryByText(/short-lived-demo-password/)).not.toBeInTheDocument();
  });

  it('starts a browser capture from the entered URL and brings recorded steps into the editor when stopped', async () => {
    const { api } = makeBridge();
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    fireEvent.change(screen.getByLabelText('Starting URL'), { target: { value: 'https://example.test/billing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await screen.findByRole('button', { name: 'Stop recording' });
    expect(api.startRecording).toHaveBeenCalledWith('https://example.test/billing');

    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await waitFor(() => expect(api.stopRecording).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Recording stopped. 3 steps are ready to edit.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select step 1: Open the billing page' })).toBeInTheDocument();
    expect(api.getPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Raw replay video before masks')).toHaveAttribute('src', 'demoforge-media://capture/revision-1/video');
  });

  it('keeps the editor locked during replay cancellation until the replay call settles', async () => {
    const { api } = makeBridge();
    let finishReplay: ((result: RunResult) => void) | undefined;
    vi.mocked(api.replay).mockImplementation(() => new Promise((resolve) => {
      finishReplay = resolve;
    }));
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    fireEvent.click(screen.getByRole('button', { name: 'Replay workflow' }));
    const cancelButton = await screen.findByRole('button', { name: 'Cancel current operation' });
    expect(cancelButton).toBeEnabled();
    expect(screen.getByLabelText('Step name')).toBeDisabled();

    fireEvent.click(cancelButton);
    await waitFor(() => expect(api.cancel).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Step name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();
    expect(finishReplay).toBeDefined();

    finishReplay?.(runFixture);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replay workflow' })).toBeEnabled());
  });

  it('offers cancellation during pending recording startup and waits for startup to settle', async () => {
    const { api } = makeBridge();
    let finishStartup: (() => void) | undefined;
    vi.mocked(api.startRecording).mockImplementation(() => new Promise((resolve) => {
      finishStartup = resolve;
    }));
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    fireEvent.change(screen.getByLabelText('Starting URL'), { target: { value: 'https://example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await waitFor(() => expect(api.startRecording).toHaveBeenCalledTimes(1));
    const cancel = await screen.findByRole('button', { name: 'Cancel current operation' });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    await waitFor(() => expect(api.cancel).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Stop recording' })).not.toBeInTheDocument();

    finishStartup?.();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Stop recording' })).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Recording startup was cancelled.');
  });

  it('blocks local paths and remote URLs returned as preview media', async () => {
    const { api } = makeBridge();
    vi.mocked(api.getPreview).mockResolvedValue({
      video: 'file:///C:/private/capture.mp4',
      screenshots: ['https://example.test/capture.png'],
    });
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    fireEvent.click(screen.getByRole('button', { name: 'Replay workflow' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('DemoForge blocked it.');
    expect(screen.queryByLabelText('Raw replay video before masks')).not.toBeInTheDocument();
    expect(screen.queryByAltText(/Raw screenshot before masks/)).not.toBeInTheDocument();
  });

  it('saves a timed opaque mask and shows its solid block on the editing surface', async () => {
    const { api } = makeBridge();
    renderStudio(api);

    await screen.findByRole('heading', { name: 'Quarterly billing tour' });
    fireEvent.click(screen.getByText('Opaque privacy masks'));
    fireEvent.change(screen.getByLabelText('x position (px)'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('y position (px)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('width (px)'), { target: { value: '260' } });
    fireEvent.change(screen.getByLabelText('height (px)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Mask starts (ms)'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Mask ends (ms)'), { target: { value: '4100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add opaque mask' }));

    expect(screen.getByLabelText('Opaque mask 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replay workflow' }));
    await waitFor(() => expect(api.getPreview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replay workflow' })).toBeEnabled());
    fireEvent.click(await screen.findByRole('button', { name: 'Show screenshot for Open the billing page' }));
    expect(await screen.findByAltText('Raw screenshot before masks: Open the billing page')).toBeInTheDocument();
    expect(screen.getByLabelText('Opaque mask 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveProject).mock.calls[0][0].edits.masks).toEqual([
      expect.objectContaining({ x: 80, y: 40, width: 260, height: 100, startMs: 900, endMs: 4100 }),
    ]);
  });
});
