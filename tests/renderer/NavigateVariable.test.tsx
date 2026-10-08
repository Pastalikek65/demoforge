// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, RunResult, StudioAPI } from '../../src/shared/types';
import { workflowHash } from '../../src/core/fingerprint';
import { parseProject } from '../../src/core/project';
import App from '../../src/renderer/App';

const projectFixture: Project = {
  schemaVersion: 1,
  name: 'Shared report tour',
  viewport: { width: 1440, height: 900 },
  steps: [
    { id: 'open-report', name: 'Open shared report', action: 'navigate', target: 'https://example.test/reports/quarterly', timeoutMs: 15000, pauseMs: 400 },
    { id: 'wait-report', name: 'Wait for report', action: 'wait', target: '#report', timeoutMs: 10000, pauseMs: 250 },
  ],
  variables: [
    { name: 'capturedEmail', secret: false, description: 'Account email' },
    { name: 'capturedSecret', secret: true, description: 'Existing secret' },
  ],
  edits: { trimStartMs: 0, masks: [], annotations: [], zooms: [], cursorHighlight: true },
};

const runFixture: RunResult = {
  schemaVersion: 1,
  status: 'passed',
  projectName: projectFixture.name,
  workflowHash: workflowHash(projectFixture),
  startedAt: '2026-10-08T12:00:00.000Z',
  durationMs: 2000,
  steps: projectFixture.steps.map((step, index) => ({
    id: step.id,
    name: step.name,
    status: 'passed',
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
  })),
  cursor: [],
};

function installBridge(project = projectFixture) {
  const bridge: StudioAPI = {
    newProject: vi.fn(async () => project),
    openProject: vi.fn(async () => ({ project, file: 'C:\\Demos\\shared-report.demo.json' })),
    saveProject: vi.fn(async () => 'C:\\Demos\\shared-report.demo.json'),
    startRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(async () => ({ project, run: runFixture })),
    replay: vi.fn(async () => runFixture),
    export: vi.fn(async () => ({ files: [], warnings: [] })),
    cancel: vi.fn(async () => undefined),
    doctor: vi.fn(async () => []),
    installBrowser: vi.fn(async () => []),
    getPreview: vi.fn(async () => ({ screenshots: [] })),
    onProgress: vi.fn(() => () => undefined),
  };
  window.demoforge = bridge;
  return bridge;
}

afterEach(() => {
  cleanup();
  delete (window as Partial<Window>).demoforge;
});

describe('runtime URL navigation', () => {
  it('blocks reserved imported variable names before invoking the desktop bridge', async () => {
    const bridge = installBridge({ ...projectFixture, variables: [...projectFixture.variables, { name: 'constructor', secret: true, description: 'Synthetic' }] });
    render(<App />);
    await screen.findByRole('heading', { name: 'Shared report tour' });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/reserved/i);
    expect(bridge.saveProject).not.toHaveBeenCalled();
  });
  it('switches a navigation step between literal URL and runtime variable without stale keys', async () => {
    const bridge = installBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Shared report tour' });
    fireEvent.click(screen.getByRole('button', { name: 'Select step 1: Open shared report' }));

    const runtimeVariable = screen.getByLabelText('Runtime URL variable');
    fireEvent.change(runtimeVariable, { target: { value: 'capturedSecret' } });
    expect(screen.getByLabelText('Navigation URL')).toHaveValue('');
    expect(screen.getByText(/URLs can contain access tokens/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(bridge.saveProject).toHaveBeenCalledTimes(1));
    let saved = vi.mocked(bridge.saveProject).mock.calls[0][0];
    expect(saved.steps[0].variable).toBe('capturedSecret');
    expect(Object.hasOwn(saved.steps[0], 'target')).toBe(false);
    expect(Object.hasOwn(saved.steps[0], 'value')).toBe(false);
    expect(parseProject(saved)).toEqual(saved);

    fireEvent.change(screen.getByLabelText('Runtime URL variable'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Navigation URL'), { target: { value: 'https://example.test/reports/quarterly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(bridge.saveProject).toHaveBeenCalledTimes(2));
    saved = vi.mocked(bridge.saveProject).mock.calls[1][0];
    expect(saved.steps[0].target).toBe('https://example.test/reports/quarterly');
    expect(Object.hasOwn(saved.steps[0], 'variable')).toBe(false);
    expect(parseProject(saved)).toEqual(saved);
  });

  it('lets a user declare a secret URL variable and sends its runtime URL only to replay', async () => {
    const bridge = installBridge({ ...projectFixture, variables: [] });
    render(<App />);
    await screen.findByRole('heading', { name: 'Shared report tour' });

    fireEvent.click(screen.getByText(/Manage runtime variables/));
    fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: 'shareToken' } });
    fireEvent.change(screen.getByLabelText('Variable description'), { target: { value: 'Quarterly share URL' } });
    expect(screen.getByLabelText('Secret variable')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));

    await screen.findByLabelText('Quarterly share URL');
    expect(screen.getByLabelText('Quarterly share URL')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Select step 1: Open shared report' }));
    fireEvent.change(screen.getByLabelText('Runtime URL variable'), { target: { value: 'shareToken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(bridge.saveProject).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(bridge.saveProject).mock.calls[0][0];
    expect(saved.variables).toContainEqual({ name: 'shareToken', secret: true, description: 'Quarterly share URL' });
    expect(saved.steps[0].variable).toBe('shareToken');
    expect(Object.hasOwn(saved.steps[0], 'target')).toBe(false);
    expect(parseProject(saved)).toEqual(saved);

    const secretUrl = 'https://example.test/share?token=run-only-value';
    fireEvent.click(screen.getByRole('button', { name: 'Replay workflow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Open shared report needs a URL for runtime variable shareToken.');
    expect(bridge.replay).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Quarterly share URL'), { target: { value: secretUrl } });
    fireEvent.click(screen.getByRole('button', { name: 'Replay workflow' }));
    await waitFor(() => expect(bridge.replay).toHaveBeenCalledTimes(1));
    expect(bridge.replay).toHaveBeenCalledWith(saved, { shareToken: secretUrl });
    expect(JSON.stringify(vi.mocked(bridge.saveProject).mock.calls[0][0])).not.toContain('run-only-value');
  });

  it('blocks sensitive literal URL query keys and keeps the URL out of the step list', async () => {
    const sensitiveProject = {
      ...projectFixture,
      steps: [{ ...projectFixture.steps[0], target: 'https://example.test/share?token=must-not-be-shown' }, projectFixture.steps[1]],
    };
    const bridge = installBridge(sensitiveProject);
    render(<App />);
    await screen.findByRole('heading', { name: 'Shared report tour' });

    expect(screen.getByText('URL with sensitive query')).toBeInTheDocument();
    expect(screen.queryByText(/must-not-be-shown/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Move the full URL to a secret runtime variable.');
    expect(bridge.saveProject).not.toHaveBeenCalled();
  });

  it('lets an existing URL variable be marked secret before using a sensitive runtime URL', async () => {
    const bridge = installBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Shared report tour' });
    fireEvent.click(screen.getByRole('button', { name: 'Select step 1: Open shared report' }));
    fireEvent.change(screen.getByLabelText('Runtime URL variable'), { target: { value: 'capturedEmail' } });
    const sensitiveUrl = 'https://example.test/share?token=short-lived-token';
    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: sensitiveUrl } });
    fireEvent.click(screen.getByRole('button', { name: 'Replay workflow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mark capturedEmail as secret in runtime variable settings.');
    expect(bridge.replay).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/Manage runtime variables/));
    fireEvent.click(screen.getByLabelText('Mark capturedEmail as secret'));

    const runtimeUrl = screen.getByLabelText('Account email');
    expect(runtimeUrl).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Replay workflow' }));

    await waitFor(() => expect(bridge.replay).toHaveBeenCalledTimes(1));
    expect(bridge.replay).toHaveBeenCalledWith(
      expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ action: 'navigate', variable: 'capturedEmail' })]) }),
      { capturedEmail: sensitiveUrl, capturedSecret: '' },
    );
    expect(screen.queryByText(/short-lived-token/)).not.toBeInTheDocument();
  });
});
