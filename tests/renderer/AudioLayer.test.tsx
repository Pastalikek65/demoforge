// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, RunResult, StudioAPI } from '../../src/shared/types';
import App from '../../src/renderer/App';

function project(name: string, audio?: Project['edits']['audio']): Project {
  return {
    schemaVersion: 1,
    name,
    viewport: { width: 1280, height: 720 },
    steps: [],
    variables: [],
    edits: {
      trimStartMs: 0,
      masks: [],
      annotations: [],
      zooms: [],
      cursorHighlight: true,
      ...(audio ? { audio } : {}),
    },
  };
}

const emptyProject = project('Untitled workflow');
const audioProject = project('Narrated tour', {
  file: 'C:\\Demos\\narration.wav',
  startMs: 600,
  volume: 0.35,
});
const run: RunResult = {
  schemaVersion: 1,
  status: 'passed',
  projectName: emptyProject.name,
  workflowHash: 'audio-layer-test',
  startedAt: '2026-10-08T12:00:00.000Z',
  durationMs: 0,
  steps: [],
  cursor: [],
};

function installBridge(openedProjects: Project[]): StudioAPI {
  const bridge: StudioAPI = {
    newProject: vi.fn(async () => emptyProject),
    openProject: vi.fn(async () => {
      const next = openedProjects.shift();
      return next ? { project: next, file: `C:\\Demos\\${next.name}.demo.json` } : null;
    }),
    saveProject: vi.fn(async () => 'C:\\Demos\\saved.demo.json'),
    startRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(async () => ({ project: emptyProject, run })),
    replay: vi.fn(async () => run),
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

describe('supplied audio layer editing', () => {
  it('loads audio settings from an opened project so its file can be updated without losing timing or volume', async () => {
    const bridge = installBridge([audioProject]);
    render(<App />);
    await screen.findByRole('heading', { name: 'Untitled workflow' });
    fireEvent.click(screen.getByText('Supplied audio'));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('heading', { name: 'Narrated tour' });

    const audioEditor = within(screen.getByText('Supplied audio').closest('details')!);
    expect(audioEditor.getByLabelText('Audio file path')).toHaveValue('C:\\Demos\\narration.wav');
    expect(audioEditor.getByLabelText('Starts (ms)')).toHaveValue(600);
    expect(audioEditor.getByLabelText('Volume')).toHaveValue(0.35);

    fireEvent.change(audioEditor.getByLabelText('Audio file path'), { target: { value: 'C:\\Demos\\narration-v2.wav' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update audio layer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));

    await waitFor(() => expect(bridge.saveProject).toHaveBeenCalledTimes(1));
    expect(vi.mocked(bridge.saveProject).mock.calls[0][0].edits.audio).toEqual({
      file: 'C:\\Demos\\narration-v2.wav',
      startMs: 600,
      volume: 0.35,
    });
  });

  it('discards an unfinished audio draft when another project is opened', async () => {
    const bridge = installBridge([audioProject, project('Silent tour')]);
    render(<App />);
    await screen.findByRole('heading', { name: 'Untitled workflow' });
    fireEvent.click(screen.getByText('Supplied audio'));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('heading', { name: 'Narrated tour' });

    const audioEditor = within(screen.getByText('Supplied audio').closest('details')!);
    fireEvent.change(audioEditor.getByLabelText('Audio file path'), { target: { value: 'C:\\Demos\\unsaved-draft.wav' } });
    fireEvent.change(audioEditor.getByLabelText('Starts (ms)'), { target: { value: '1450' } });
    fireEvent.change(audioEditor.getByLabelText('Volume'), { target: { value: '0.8' } });
    expect(audioEditor.getByLabelText('Audio file path')).toHaveValue('C:\\Demos\\unsaved-draft.wav');

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('heading', { name: 'Silent tour' });

    expect(audioEditor.getByLabelText('Audio file path')).toHaveValue('');
    expect(audioEditor.getByLabelText('Starts (ms)')).toHaveValue(0);
    expect(audioEditor.getByLabelText('Volume')).toHaveValue(1);
    expect(bridge.openProject).toHaveBeenCalledTimes(2);
  });
});
