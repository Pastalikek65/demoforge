import { useEffect, useMemo, useRef, useState } from 'react';
import { isReservedVariableName } from '../shared/variables.js';
import type {
  Action,
  Annotation,
  ExportOptions,
  Mask,
  Project,
  RunResult,
  Step,
  StepResult,
  StudioAPI,
} from '../shared/types';
import { hasSensitiveUrlQuery, isHttpUrl } from '../shared/url';

const actions: Action[] = ['navigate', 'click', 'fill', 'select', 'wait'];
const exportChoices: { value: ExportOptions['formats'][number]; label: string }[] = [
  { value: 'mp4', label: 'MP4 video' },
  { value: 'gif', label: 'GIF preview' },
  { value: 'markdown', label: 'Markdown guide' },
  { value: 'html', label: 'HTML guide' },
];

type BusyAction = 'new' | 'open' | 'save' | 'startRecording' | 'stopRecording' | 'replay' | 'export' | 'installBrowser';
type PreviewData = {
  video?: string;
  screenshots: { index: number; url: string }[];
};

function isTrustedPreviewUrl(value: string | undefined): value is string {
  return value !== undefined && /^demoforge-media:\/\/capture\/[A-Za-z0-9-]+\/(?:video|step-\d+)$/.test(value);
}

function desktopApi(): StudioAPI {
  if (!window.demoforge) {
    throw new Error('The desktop connection is unavailable. Open DemoForge from the desktop app and try again.');
  }
  return window.demoforge;
}

function errorText(action: string, error: unknown, secrets: string[] = []) {
  const rawMessage = error instanceof Error ? error.message : String(error || 'Unexpected desktop error');
  if (/cancel(?:led|ed)?/i.test(rawMessage)) return `${action} was cancelled.`;

  let detail = hideSecrets(rawMessage, secrets);
  if (/ENOENT|not found/i.test(detail)) detail = 'A required file could not be found. Check the file path and try again.';
  if (/permission|EACCES|EPERM/i.test(detail)) detail = 'DemoForge could not access that file or folder. Choose a location you can use.';
  return `${action} failed. ${detail}`;
}

function hideSecrets(message: string, secrets: string[]) {
  return secrets.reduce((visible, secret) => secret.length > 0 ? visible.split(secret).join('[hidden]') : visible, message);
}

function sanitizeRunResult(result: RunResult, secrets: string[]): RunResult {
  return {
    ...result,
    steps: result.steps.map((step) => step.error ? { ...step, error: hideSecrets(step.error, secrets) } : step),
  };
}

function fileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function makeId(kind: string) {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function numericInput(value: string) {
  return value === '' ? 0 : Number(value);
}

function audioDraftFor(audio: Project['edits']['audio']) {
  return {
    file: audio?.file ?? '',
    startMs: String(audio?.startMs ?? 0),
    volume: String(audio?.volume ?? 1),
  };
}

function isIntegerBetween(value: number, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function projectEditorError(project: Project): string | null {
  if (!project.name.trim()) return 'Enter a project name before saving or replaying.';
  if (project.name.length > 200) return 'Project names can be at most 200 characters.';
  if (!isIntegerBetween(project.viewport.width, 160, 4096)) return 'Viewport width must be a whole number from 160 to 4096 pixels.';
  if (!isIntegerBetween(project.viewport.height, 120, 4096)) return 'Viewport height must be a whole number from 120 to 4096 pixels.';
  if (project.steps.length > 500) return 'A project can contain at most 500 steps.';
  if (project.variables.length > 500) return 'A project can contain at most 500 runtime variables.';
  if (project.edits.masks.length > 2_000) return 'A project can contain at most 2,000 privacy masks.';
  if (project.edits.annotations.length > 2_000) return 'A project can contain at most 2,000 subtitles.';
  if (project.edits.zooms.length > 500) return 'A project can contain at most 500 zoom moments.';
  if (project.variables.some(variable => isReservedVariableName(variable.name))) return 'Reserved runtime variable names cannot be used.';
  if (project.variables.some((variable) => variable.name.length > 64 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name))) {
    return 'Runtime variable names must be valid identifiers of at most 64 characters.';
  }
  const variables = new Set(project.variables.map((variable) => variable.name));
  if (variables.size !== project.variables.length) return 'Runtime variable names must be unique.';

  for (let index = 0; index < project.steps.length; index += 1) {
    const step = project.steps[index];
    const label = `Step ${index + 1}`;
    if (!step.name.trim()) return `${label} needs a name.`;
    if (step.name.length > 200) return `${label} names can be at most 200 characters.`;
    if ((step.target?.length ?? 0) > 2048) return `${label} locators and URLs can be at most 2,048 characters.`;
    if ((step.value?.length ?? 0) > 10_000) return `${label} values can be at most 10,000 characters.`;
    if (!isIntegerBetween(step.timeoutMs, 1, 120_000)) return `${label} timeout must be a whole number from 1 to 120,000 ms.`;
    if (!isIntegerBetween(step.pauseMs, 0, 60_000)) return `${label} pause must be a whole number from 0 to 60,000 ms.`;
    if (step.action === 'navigate') {
      if ((step.target === undefined) === (step.variable === undefined)) return `${label} needs exactly one literal URL or runtime URL variable.`;
      if (step.target !== undefined && !isHttpUrl(step.target)) return `${label} needs a complete HTTP or HTTPS URL without embedded credentials.`;
      if (step.target !== undefined && hasSensitiveUrlQuery(step.target)) return `${label} URL has a sensitive query key. Move the full URL to a secret runtime variable.`;
      if (step.variable !== undefined && !variables.has(step.variable)) return `${label} refers to a runtime URL variable that no longer exists.`;
    }
    if (['click', 'fill', 'select'].includes(step.action) && !step.target?.trim()) return `${label} needs a locator.`;
    if (['fill', 'select'].includes(step.action)) {
      if ((step.value === undefined) === (step.variable === undefined)) return `${label} needs exactly one literal value or runtime variable.`;
      if (step.variable !== undefined && !variables.has(step.variable)) return `${label} refers to a runtime variable that no longer exists.`;
    } else if (step.value !== undefined || (step.variable !== undefined && step.action !== 'navigate')) {
      return `${label} ${step.action} does not accept a value or runtime variable.`;
    }
  }

  const timeLimit = 24 * 60 * 60 * 1_000;
  if (!isIntegerBetween(project.edits.trimStartMs, 0, timeLimit)
    || (project.edits.trimEndMs !== undefined && !isIntegerBetween(project.edits.trimEndMs, 0, timeLimit))) {
    return 'Trim points must be whole numbers from 0 to 86,400,000 ms.';
  }
  for (const [index, mask] of project.edits.masks.entries()) {
    if (!isIntegerBetween(mask.startMs, 0, timeLimit) || !isIntegerBetween(mask.endMs, 1, timeLimit)
      || mask.endMs <= mask.startMs || mask.x < 0 || mask.y < 0 || mask.width <= 0 || mask.height <= 0
      || mask.x + mask.width > project.viewport.width || mask.y + mask.height > project.viewport.height) {
      return `Privacy mask ${index + 1} needs a positive size inside the viewport and a valid time range.`;
    }
  }
  for (const [index, annotation] of project.edits.annotations.entries()) {
    if (!annotation.text.trim() || annotation.text.length > 10_000 || !isIntegerBetween(annotation.startMs, 0, timeLimit)
      || !isIntegerBetween(annotation.endMs, 1, timeLimit) || annotation.endMs <= annotation.startMs) {
      return `Subtitle ${index + 1} needs text and a valid time range.`;
    }
  }
  return null;
}

function runtimeUrlError(project: Project, values: Record<string, string>): string | null {
  const variables = new Map(project.variables.map((variable) => [variable.name, variable]));
  for (const step of project.steps) {
    if (step.action !== 'navigate' || !step.variable) continue;
    const variable = variables.get(step.variable);
    const url = values[step.variable] ?? '';
    if (!url.trim()) return `${step.name} needs a URL for runtime variable ${step.variable}.`;
    if (!isHttpUrl(url)) return `${step.name} needs a complete HTTP or HTTPS URL without embedded credentials.`;
    if (hasSensitiveUrlQuery(url) && !variable?.secret) {
      return `${step.name} URL contains a sensitive query key. Mark ${step.variable} as secret in runtime variable settings.`;
    }
  }
  return null;
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, milliseconds) / 1000;
  return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
}

function trackStyle(startMs: number, endMs: number, durationMs: number) {
  const left = Math.max(0, Math.min(100, (startMs / durationMs) * 100));
  const right = Math.max(left + 1.5, Math.min(100, (endMs / durationMs) * 100));
  return { left: `${left}%`, width: `${right - left}%` };
}

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [projectFile, setProjectFile] = useState('');
  const [selectedStepId, setSelectedStepId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordUrl, setRecordUrl] = useState('');
  const [runtimeValues, setRuntimeValues] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Record<string, StepResult>>({});
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [selectedScreenshotIndex, setSelectedScreenshotIndex] = useState<number | null>(null);
  const [mediaTimeMs, setMediaTimeMs] = useState(0);
  const [exportFormats, setExportFormats] = useState<ExportOptions['formats']>(['mp4']);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [doctorChecks, setDoctorChecks] = useState<{ name: string; ok: boolean; detail: string }[] | null>(null);
  const [setupError, setSetupError] = useState('');
  const [setupNotice, setSetupNotice] = useState('');
  const [maskDraft, setMaskDraft] = useState({ x: '28', y: '28', width: '240', height: '110', startMs: '0', endMs: '3000' });
  const [annotationDraft, setAnnotationDraft] = useState({ text: '', startMs: '0', endMs: '3000' });
  const [zoomDraft, setZoomDraft] = useState({ scale: '1.5', x: '0', y: '0', startMs: '0', endMs: '2000' });
  const [audioDraft, setAudioDraft] = useState({ file: '', startMs: '0', volume: '1' });
  const [variableDraft, setVariableDraft] = useState({ name: '', description: '', secret: true });
  const cancellationRequestedRef = useRef(false);

  const selectedStep = project?.steps.find((step) => step.id === selectedStepId) ?? null;
  const selectedStepIndex = project?.steps.findIndex((step) => step.id === selectedStepId) ?? -1;
  const activeCrop = project?.edits.crop;
  const isBusy = busy !== null;
  const lockWorkspace = isBusy || recording;
  const secretVariableNames = useMemo(
    () => new Set(project?.variables.filter((variable) => variable.secret).map((variable) => variable.name) ?? []),
    [project],
  );
  const secretValues = useMemo(
    () => Object.entries(runtimeValues).filter(([name]) => secretVariableNames.has(name)).map(([, value]) => value),
    [runtimeValues, secretVariableNames],
  );
  const secretValuesRef = useRef(secretValues);
  secretValuesRef.current = secretValues;
  const previewImages = preview?.screenshots.map((screenshot) => ({
    ...screenshot,
    step: runResult?.steps[screenshot.index],
  })) ?? [];
  const selectedScreenshot = previewImages.find((screenshot) => screenshot.index === selectedScreenshotIndex) ?? previewImages[0] ?? null;
  const showingVideo = Boolean(preview?.video && selectedScreenshotIndex === null);
  const hasMediaPreview = Boolean(preview?.video || previewImages.length > 0);
  const activeMediaTime = showingVideo ? mediaTimeMs : selectedScreenshot?.step?.endMs ?? 0;
  const visibleMasks = project?.edits.masks.filter((mask) => activeMediaTime >= mask.startMs && activeMediaTime < mask.endMs) ?? [];

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const initial = await desktopApi().newProject();
        if (active) {
          replaceProject(initial);
          setSelectedStepId(initial.steps[0]?.id ?? '');
        }
      } catch (loadError) {
        if (active) setError(errorText('Opening a new project', loadError));
      }
    })();
    void (async () => {
      try {
        const checks = await desktopApi().doctor();
        if (active) setDoctorChecks(checks);
      } catch (doctorError) {
        if (active) setError(errorText('Checking local requirements', doctorError));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!window.demoforge) return undefined;
    return window.demoforge.onProgress((step) => {
      const safeStep = step.error ? { ...step, error: hideSecrets(step.error, secretValuesRef.current) } : step;
      setProgress((current) => ({ ...current, [safeStep.id]: safeStep }));
    });
  }, []);

  function editProject(transform: (current: Project) => Project) {
    setProject((current) => current ? transform(current) : current);
    setDirty(true);
    setReviewed(false);
    setNotice('');
  }

  function replaceProject(next: Project) {
    setProject(next);
    setAudioDraft(audioDraftFor(next.edits.audio));
  }

  function updateStep(stepId: string, key: keyof Step, value: unknown) {
    editProject((current) => ({
      ...current,
      steps: current.steps.map((step) => {
        if (step.id !== stepId) return step;
        const next: Step = { ...step };
        if (key === 'action') {
          const action = value as Action;
          next.action = action;
          if (action === 'navigate') {
            delete next.value;
            if (next.variable) delete next.target;
            else if (!isHttpUrl(next.target ?? '')) delete next.target;
          } else if (step.action === 'navigate') {
            delete next.target;
            delete next.variable;
            if (action === 'fill' || action === 'select') next.value = '';
          } else if (action === 'click' || action === 'wait') {
            delete next.value;
            delete next.variable;
          } else if (step.action !== 'fill' && step.action !== 'select') {
            delete next.value;
            delete next.variable;
            next.value = '';
          }
          return next;
        }
        if (key === 'value') {
          delete next.variable;
          next.value = String(value);
          return next;
        }
        if (key === 'variable') {
          if (typeof value === 'string' && value.length > 0) {
            if (next.action === 'navigate') delete next.target;
            delete next.value;
            next.variable = value;
          } else {
            delete next.variable;
            if (next.action === 'navigate') delete next.target;
            if (next.value === undefined && (next.action === 'fill' || next.action === 'select')) next.value = '';
          }
          return next;
        }
        if (key === 'target') {
          if (value === '') delete next.target;
          else {
            next.target = String(value);
            if (next.action === 'navigate') delete next.variable;
          }
        } else Object.assign(next, { [key]: value });
        return next;
      }),
    }));
  }

  function addRuntimeVariable() {
    if (!project) return;
    const name = variableDraft.name.trim();
    const description = variableDraft.description.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) {
      setError('Use a variable name that starts with a letter or underscore and contains only letters, numbers, and underscores (up to 64 characters).');
      return;
    }
    if (project.variables.some((variable) => variable.name === name)) {
      setError(`A runtime variable named ${name} already exists.`);
      return;
    }
    if (isReservedVariableName(name)) {
      setError('Reserved runtime variable names cannot be used.');
      return;
    }
    if (project.variables.length >= 500) {
      setError('A project can contain at most 500 runtime variables.');
      return;
    }
    if (description.length > 2_000) {
      setError('Variable descriptions can be at most 2,000 characters.');
      return;
    }
    editProject((current) => ({
      ...current,
      variables: [...current.variables, { name, secret: variableDraft.secret, description }],
    }));
    setVariableDraft({ name: '', description: '', secret: true });
    setNotice(`Added ${variableDraft.secret ? 'secret ' : ''}runtime variable ${name}.`);
    setError('');
  }

  function removeRuntimeVariable(name: string) {
    if (!project || project.steps.some((step) => step.variable === name)) return;
    editProject((current) => ({
      ...current,
      variables: current.variables.filter((variable) => variable.name !== name),
    }));
    setRuntimeValues((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function updateRuntimeVariableSecret(name: string, secret: boolean) {
    editProject((current) => ({
      ...current,
      variables: current.variables.map((variable) => variable.name === name ? { ...variable, secret } : variable),
    }));
  }

  function updateEdit<K extends keyof Project['edits']>(key: K, value: Project['edits'][K]) {
    if (key === 'audio') setAudioDraft(audioDraftFor(value as Project['edits']['audio']));
    editProject((current) => {
      const edits = { ...current.edits };
      if (value === undefined) delete edits[key];
      else Object.assign(edits, { [key]: value });
      return { ...current, edits };
    });
  }

  async function loadPreview() {
    setPreviewLoading(true);
    try {
      const result = await desktopApi().getPreview();
      const screenshots = result.screenshots.flatMap((url, index) => isTrustedPreviewUrl(url)
        ? [{ index, url }]
        : []);
      const video = isTrustedPreviewUrl(result.video) ? result.video : undefined;
      if ((result.video && !video) || screenshots.length !== result.screenshots.filter(Boolean).length) {
        setError('The desktop returned an unsupported preview address. DemoForge blocked it.');
      }
      setPreview({ video, screenshots });
      setPreviewRevision((revision) => revision + 1);
      setSelectedScreenshotIndex(null);
      setMediaTimeMs(0);
    } catch (previewError) {
      setPreview(null);
      setError(errorText('Loading the raw replay preview', previewError));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function createProject() {
    if (dirty && !window.confirm('Start a new project? Unsaved changes will be discarded.')) return;
    setBusy('new');
    setError('');
    setNotice('');
    try {
      const next = await desktopApi().newProject();
      replaceProject(next);
      setProjectFile('');
      setSelectedStepId(next.steps[0]?.id ?? '');
      setDirty(false);
      setRunResult(null);
      setPreview(null);
      setSelectedScreenshotIndex(null);
      setProgress({});
      setReviewed(false);
      setRuntimeValues({});
      setNotice('New project ready. Add steps or start a recording.');
    } catch (actionError) {
      setError(errorText('Creating a new project', actionError));
    } finally {
      setBusy(null);
    }
  }

  async function openProject() {
    if (dirty && !window.confirm('Open another project? Unsaved changes will be discarded.')) return;
    setBusy('open');
    setError('');
    setNotice('');
    try {
      const opened = await desktopApi().openProject();
      if (!opened) {
        setNotice('Open canceled. Your current project is still here.');
        return;
      }
      replaceProject(opened.project);
      setProjectFile(opened.file);
      setSelectedStepId(opened.project.steps[0]?.id ?? '');
      setDirty(false);
      setRunResult(null);
      setPreview(null);
      setSelectedScreenshotIndex(null);
      setProgress({});
      setReviewed(false);
      setRuntimeValues({});
      setNotice(`Opened ${fileName(opened.file)}.`);
    } catch (actionError) {
      setError(errorText('Opening the project', actionError));
    } finally {
      setBusy(null);
    }
  }

  async function installBrowser() {
    setBusy('installBrowser');
    setSetupError('');
    setSetupNotice('Downloading the local browser runtime. This one-time setup may take a few minutes.');
    try {
      const checks = await desktopApi().installBrowser();
      setDoctorChecks(checks);
      const browser = checks.find((check) => check.name.toLowerCase() === 'chromium');
      setSetupNotice(browser?.ok ? 'Browser setup finished. DemoForge checked local requirements again.' : 'Setup finished, but Chromium is still unavailable. Review the local requirements below.');
    } catch (installError) {
      setSetupError(errorText('Installing the browser', installError));
      setSetupNotice('');
    } finally {
      setBusy(null);
    }
  }

  async function saveProject() {
    if (!project) return;
    const validationError = projectEditorError(project);
    if (validationError) {
      setError(validationError);
      setNotice('');
      return;
    }
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const savedFile = await desktopApi().saveProject(project);
      if (!savedFile) {
        setNotice('Save canceled. Your changes are still in this editor.');
        return;
      }
      setProjectFile(savedFile);
      setDirty(false);
      setNotice(`Saved ${fileName(savedFile)}.`);
    } catch (actionError) {
      setError(errorText('Saving the project', actionError));
    } finally {
      setBusy(null);
    }
  }

  async function startRecording() {
    const trimmedUrl = recordUrl.trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      setError('Enter a complete website address, such as https://example.com.');
      return;
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      setError('Recording can start only from an http or https website.');
      return;
    }

    setBusy('startRecording');
    cancellationRequestedRef.current = false;
    setError('');
    setNotice('');
    try {
      await desktopApi().startRecording(trimmedUrl);
      if (cancellationRequestedRef.current) {
        await desktopApi().cancel();
        setRecording(false);
        setNotice('Recording startup was cancelled.');
        return;
      }
      setRecording(true);
      setRunResult(null);
      setPreview(null);
      setSelectedScreenshotIndex(null);
      setProgress({});
      setReviewed(false);
      setNotice(`Recording started at ${parsedUrl.host}. Stop when the workflow is complete.`);
    } catch (actionError) {
      setError(errorText('Starting the recording', actionError));
    } finally {
      setCancelling(false);
      setBusy(null);
    }
  }

  async function stopRecording() {
    setBusy('stopRecording');
    setError('');
    setNotice('');
    try {
      const captured = await desktopApi().stopRecording();
      replaceProject(captured.project);
      setSelectedStepId(captured.project.steps[0]?.id ?? '');
      setDirty(true);
      setRecording(false);
      const safeRun = sanitizeRunResult(captured.run, secretValuesRef.current);
      setRunResult(safeRun);
      setProgress(Object.fromEntries(safeRun.steps.map((step) => [step.id, step])));
      setPreview(null);
      await loadPreview();
      setReviewed(false);
      setRuntimeValues({});
      setNotice(`Recording stopped. ${captured.project.steps.length} steps are ready to edit.`);
    } catch (actionError) {
      setError(errorText('Stopping the recording', actionError));
    } finally {
      setBusy(null);
    }
  }

  async function cancelCurrent() {
    const operation = busy;
    const waitingForActiveOperation = operation === 'startRecording' || operation === 'replay' || operation === 'export';
    cancellationRequestedRef.current = true;
    setCancelling(true);
    setError('');
    try {
      await desktopApi().cancel();
      setRecording(false);
      setNotice(waitingForActiveOperation ? 'Cancellation requested. Waiting for the current operation to stop.' : 'The recording was cancelled.');
    } catch (actionError) {
      setError(errorText('Cancelling the operation', actionError));
      setCancelling(false);
    } finally {
      if (!waitingForActiveOperation) setCancelling(false);
    }
  }

  async function replayWorkflow() {
    if (!project) return;
    const validationError = projectEditorError(project);
    if (validationError) {
      setError(validationError);
      setNotice('');
      return;
    }
    const values = Object.fromEntries(project.variables.map((variable) => [variable.name, runtimeValues[variable.name] ?? '']));
    const runtimeValidationError = runtimeUrlError(project, values);
    if (runtimeValidationError) {
      setError(runtimeValidationError);
      setNotice('');
      return;
    }
    setBusy('replay');
    setError('');
    setNotice('');
    setReviewed(false);
    setProgress({});
    setRunResult(null);
    setPreview(null);
    setSelectedScreenshotIndex(null);
    setMediaTimeMs(0);
    try {
      const result = sanitizeRunResult(await desktopApi().replay(project, values), secretValues);
      setRunResult(result);
      setProgress(Object.fromEntries(result.steps.map((step) => [step.id, step])));
      await loadPreview();
      setNotice(result.status === 'passed' ? 'Replay completed. Review the run before exporting.' : 'Replay stopped at a failed step. Review the error and adjust the workflow.');
    } catch (actionError) {
      setError(errorText('Replaying the workflow', actionError, secretValues));
    } finally {
      setRuntimeValues((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !secretVariableNames.has(name))));
      setCancelling(false);
      setBusy(null);
    }
  }

  async function exportProject() {
    if (!project) return;
    if (!reviewed) {
      setError('Review the recording and its redactions before exporting.');
      return;
    }
    if (exportFormats.length === 0) {
      setError('Choose at least one export format.');
      return;
    }
    setBusy('export');
    setError('');
    setNotice('');
    try {
      const result = await desktopApi().export(project, exportFormats, true);
      const exportedNames = result.files.map(fileName);
      setNotice(exportedNames.length > 0 ? `Exported ${exportedNames.join(', ')}.` : 'Export finished with no output files.');
      if (result.warnings.length > 0) setNotice((current) => `${current} ${result.warnings.join(' ')}`);
    } catch (actionError) {
      setError(errorText('Exporting the recording', actionError, secretValues));
    } finally {
      setCancelling(false);
      setBusy(null);
    }
  }

  function addStep() {
    if (!project) return;
    const step: Step = { id: makeId('step'), name: 'Wait for page content', action: 'wait', timeoutMs: 15000, pauseMs: 500 };
    editProject((current) => ({ ...current, steps: [...current.steps, step] }));
    setSelectedStepId(step.id);
  }

  function moveSelectedStep(direction: -1 | 1) {
    if (!project || selectedStepIndex < 0) return;
    const destination = selectedStepIndex + direction;
    if (destination < 0 || destination >= project.steps.length) return;
    const steps = [...project.steps];
    [steps[selectedStepIndex], steps[destination]] = [steps[destination], steps[selectedStepIndex]];
    editProject((current) => ({ ...current, steps }));
  }

  function deleteSelectedStep() {
    if (!project || !selectedStep) return;
    const remaining = project.steps.filter((step) => step.id !== selectedStep.id);
    const nextSelection = remaining[Math.min(selectedStepIndex, remaining.length - 1)]?.id ?? '';
    editProject((current) => ({ ...current, steps: remaining }));
    setSelectedStepId(nextSelection);
  }

  function addMask() {
    const mask: Mask = {
      id: makeId('mask'),
      x: numericInput(maskDraft.x),
      y: numericInput(maskDraft.y),
      width: numericInput(maskDraft.width),
      height: numericInput(maskDraft.height),
      startMs: numericInput(maskDraft.startMs),
      endMs: numericInput(maskDraft.endMs),
    };
    if (mask.x < 0 || mask.y < 0 || mask.width <= 0 || mask.height <= 0 || mask.endMs <= mask.startMs) {
      setError('A mask needs a positive size and an end time after its start time.');
      return;
    }
    updateEdit('masks', [...(project?.edits.masks ?? []), mask]);
  }

  function removeMask(maskId: string) {
    updateEdit('masks', project?.edits.masks.filter((mask) => mask.id !== maskId) ?? []);
  }

  function addAnnotation() {
    const text = annotationDraft.text.trim();
    if (!text) return;
    const annotation: Annotation = {
      id: makeId('annotation'),
      text,
      startMs: numericInput(annotationDraft.startMs),
      endMs: numericInput(annotationDraft.endMs),
    };
    if (annotation.endMs <= annotation.startMs) {
      setError('A subtitle needs an end time after its start time.');
      return;
    }
    updateEdit('annotations', [...(project?.edits.annotations ?? []), annotation]);
    setAnnotationDraft((current) => ({ ...current, text: '' }));
  }

  function addZoom() {
    const zoom = {
      scale: numericInput(zoomDraft.scale),
      x: numericInput(zoomDraft.x),
      y: numericInput(zoomDraft.y),
      startMs: numericInput(zoomDraft.startMs),
      endMs: numericInput(zoomDraft.endMs),
    };
    if (zoom.scale < 1 || zoom.endMs <= zoom.startMs) {
      setError('A zoom needs a scale of at least 1 and an end time after its start time.');
      return;
    }
    updateEdit('zooms', [...(project?.edits.zooms ?? []), zoom]);
  }

  function updateCrop<K extends keyof NonNullable<Project['edits']['crop']>>(
    key: K,
    value: NonNullable<Project['edits']['crop']>[K],
  ) {
    const crop = project?.edits.crop ?? { x: 0, y: 0, width: project?.viewport.width ?? 1280, height: project?.viewport.height ?? 720 };
    updateEdit('crop', { ...crop, [key]: value });
  }

  function setExportFormat(format: ExportOptions['formats'][number], checked: boolean) {
    setExportFormats((current) => checked
      ? current.includes(format) ? current : [...current, format]
      : current.filter((item) => item !== format));
  }

  const timelineEnd = Math.max(
    10000,
    runResult?.durationMs ?? 0,
    project?.edits.trimEndMs ?? 0,
    project?.edits.audio?.startMs ?? 0,
    ...(project?.edits.masks.map((mask) => mask.endMs) ?? []),
    ...(project?.edits.annotations.map((annotation) => annotation.endMs) ?? []),
    ...(project?.edits.zooms.map((zoom) => zoom.endMs) ?? []),
  );
  const canCancel = !cancelling && (recording || busy === 'startRecording' || busy === 'replay' || busy === 'export');
  const missingChecks = doctorChecks?.filter((check) => !check.ok) ?? [];
  const browserMissing = missingChecks.some((check) => check.name.toLowerCase() === 'chromium');

  if (!project) {
    return (
      <div className="loading-shell">
        <div className="loading-card">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <p className="loading-kicker">DemoForge studio</p>
          <h1>{error ? 'Studio could not start' : 'Opening your workspace'}</h1>
          <p>{error || 'Preparing a local project and connecting to the desktop editor.'}</p>
          {error && <button className="button button--primary" type="button" onClick={() => window.location.reload()}>Try again</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="DemoForge Studio">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <span className="brand-name">DemoForge</span>
          <span className="brand-product">Studio</span>
        </div>

        <div className="project-heading">
          <span className="project-heading__label">Editing project</span>
          <h1 className="visually-hidden">{project.name || 'Untitled workflow'}</h1>
          <input
            className="project-title-input"
            aria-label="Project name"
            aria-invalid={!project.name.trim() || project.name.length > 200}
            maxLength={200}
            value={project.name}
            disabled={lockWorkspace}
            onChange={(event) => { const name = event.currentTarget.value; editProject((current) => ({ ...current, name })); }}
          />
          <span className="project-heading__path">{projectFile ? fileName(projectFile) : dirty ? 'Unsaved changes' : 'Local project'}</span>
        </div>

        <div className="file-actions" aria-label="Project files">
          <button className="button button--quiet" type="button" onClick={createProject} disabled={lockWorkspace}>New</button>
          <button className="button button--quiet" type="button" onClick={openProject} disabled={lockWorkspace}>Open</button>
          <button className="button button--save" type="button" onClick={saveProject} disabled={lockWorkspace}>Save project</button>
        </div>
      </header>

      {(error || notice) && (
        <div className={`message-bar ${error ? 'message-bar--error' : 'message-bar--notice'}`} role={error ? 'alert' : 'status'}>
          <span>{error || notice}</span>
          <button className="message-bar__close" type="button" aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}>×</button>
        </div>
      )}

      {missingChecks.length > 0 && <section className="setup-panel" aria-label="Local requirements" role="region">
        <div className="setup-panel__copy">
          <strong>Local setup needs attention</strong>
          {missingChecks.map((check) => <p key={check.name}><b>{check.name}:</b> {check.detail}</p>)}
          {setupError && <p className="setup-panel__error" role="alert">{setupError}</p>}
          {setupNotice && <p className="setup-panel__notice" role="status">{setupNotice}</p>}
        </div>
        {browserMissing && <button className="button button--outline setup-panel__button" type="button" onClick={installBrowser} disabled={isBusy}>
          {busy === 'installBrowser' ? 'Installing browser…' : 'Install browser'}
        </button>}
      </section>}
      {missingChecks.length === 0 && setupNotice && <div className="setup-success" role="status">{setupNotice}</div>}

      <main className="workbench" aria-label="DemoForge editor">
        <aside className="panel sequence-panel" aria-label="Workflow steps">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Workflow</p>
              <h2>Step sequence <span className="count-badge">{project.steps.length}</span></h2>
            </div>
            <button className="icon-button icon-button--add" type="button" onClick={addStep} disabled={lockWorkspace || project.steps.length >= 500} aria-label="Add step" title="Add step">+</button>
          </div>

          <fieldset className="fieldset-reset" disabled={lockWorkspace}>
            {project.steps.length === 0 ? (
              <div className="empty-steps">
                <span className="empty-steps__glyph" aria-hidden="true">↳</span>
                <h3>No steps yet</h3>
                <p>Start a browser recording or add a wait step to build the workflow.</p>
                <button className="button button--outline" type="button" onClick={addStep}>Add first step</button>
              </div>
            ) : (
              <ol className="step-list">
                {project.steps.map((step, index) => {
                  const status = progress[step.id]?.status ?? 'not-run';
                  const selected = selectedStepId === step.id;
                  return (
                    <li className={`step-row ${selected ? 'step-row--selected' : ''}`} key={step.id}>
                      <button
                        className="step-select"
                        type="button"
                        aria-label={`Select step ${index + 1}: ${step.name || 'Untitled step'}`}
                        aria-pressed={selected}
                        onClick={() => setSelectedStepId(step.id)}
                      >
                        <span className="step-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="step-row__body">
                          <span className="step-row__name">{step.name || 'Untitled step'}</span>
                          <span className="step-row__meta"><span className={`action-tag action-tag--${step.action}`}>{step.action}</span>{(step.target || (step.action === 'navigate' && step.variable)) && <span className="step-row__locator">{step.action === 'navigate' && step.variable ? `{{${step.variable}}}` : step.action === 'navigate' && step.target && hasSensitiveUrlQuery(step.target) ? 'URL with sensitive query' : step.target}</span>}</span>
                        </span>
                        <span className={`status-dot status-dot--${status}`} aria-label={`Step ${status}`} title={status} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </fieldset>

          <div className="step-editor">
            <div className="step-editor__heading">
              <h3>{selectedStep ? 'Selected step' : 'Step details'}</h3>
              {selectedStep && <span>Step {selectedStepIndex + 1} of {project.steps.length}</span>}
            </div>
            {selectedStep ? (
              <fieldset className="fieldset-reset form-stack" disabled={lockWorkspace}>
                <label className="field">
                  <span>Step name</span>
                  <input aria-label="Step name" aria-invalid={!selectedStep.name.trim() || selectedStep.name.length > 200} maxLength={200} value={selectedStep.name} onChange={(event) => updateStep(selectedStep.id, 'name', event.currentTarget.value)} />
                  <small className="field-hint">Required · up to 200 characters</small>
                </label>
                <label className="field field--split">
                  <span>Action</span>
                  <select value={selectedStep.action} onChange={(event) => updateStep(selectedStep.id, 'action', event.currentTarget.value as Action)}>
                    {actions.map((action) => <option key={action} value={action}>{action}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>{selectedStep.action === 'navigate' ? 'Literal URL' : 'Locator'}</span>
                    <input aria-label={selectedStep.action === 'navigate' ? 'Navigation URL' : 'Locator'} maxLength={2048} value={selectedStep.target ?? ''} placeholder={selectedStep.action === 'navigate' ? 'https://example.com' : 'CSS selector'} onChange={(event) => updateStep(selectedStep.id, 'target', event.currentTarget.value)} />
                    <small className="field-hint">{selectedStep.action === 'navigate' ? 'HTTP or HTTPS URL · no embedded credentials' : 'Up to 2,048 characters'}</small>
                </label>
                {selectedStep.action === 'navigate' && <p className="field-hint url-secret-hint">{selectedStep.target && hasSensitiveUrlQuery(selectedStep.target) ? 'This URL query contains a sensitive key. Store the full URL in a secret runtime variable.' : 'URLs can contain access tokens. Prefer a secret runtime variable for a tokenized URL.'}</p>}
                {['fill', 'select'].includes(selectedStep.action) && <>
                  <label className="field">
                    <span>Value</span>
                    <input aria-label="Value" maxLength={10000} value={selectedStep.value ?? ''} onChange={(event) => updateStep(selectedStep.id, 'value', event.currentTarget.value)} />
                  </label>
                </>}
                {(selectedStep.action === 'navigate' || (['fill', 'select'].includes(selectedStep.action) && project.variables.length > 0)) && <label className="field">
                  <span>{selectedStep.action === 'navigate' ? 'Runtime URL variable' : 'Runtime variable'}</span>
                  <select aria-label={selectedStep.action === 'navigate' ? 'Runtime URL variable' : 'Runtime variable'} value={selectedStep.variable ?? ''} onChange={(event) => updateStep(selectedStep.id, 'variable', event.currentTarget.value)}>
                    <option value="">No variable</option>
                    {project.variables.map((variable) => <option value={variable.name} key={variable.name}>{variable.name}{variable.secret ? ' · secret' : ''}</option>)}
                  </select>
                </label>}
                <div className="field-row">
                  <label className="field">
                    <span>Timeout (ms)</span>
                    <input aria-label="Timeout (ms)" type="number" min="1" max="120000" step="1" aria-invalid={!isIntegerBetween(selectedStep.timeoutMs, 1, 120000)} value={selectedStep.timeoutMs} onChange={(event) => updateStep(selectedStep.id, 'timeoutMs', numericInput(event.currentTarget.value))} />
                    <small className="field-hint">1–120,000 ms · whole numbers</small>
                  </label>
                  <label className="field">
                    <span>Pause after (ms)</span>
                    <input aria-label="Pause after (ms)" type="number" min="0" max="60000" step="1" aria-invalid={!isIntegerBetween(selectedStep.pauseMs, 0, 60000)} value={selectedStep.pauseMs} onChange={(event) => updateStep(selectedStep.id, 'pauseMs', numericInput(event.currentTarget.value))} />
                    <small className="field-hint">0–60,000 ms · whole numbers</small>
                  </label>
                </div>
                <div className="step-editor__actions">
                  <div className="reorder-actions">
                    <button className="icon-button" type="button" onClick={() => moveSelectedStep(-1)} disabled={selectedStepIndex <= 0} aria-label="Move step up" title="Move step up">↑</button>
                    <button className="icon-button" type="button" onClick={() => moveSelectedStep(1)} disabled={selectedStepIndex >= project.steps.length - 1} aria-label="Move step down" title="Move step down">↓</button>
                  </div>
                  <button className="button button--danger-quiet" type="button" onClick={deleteSelectedStep}>Delete step</button>
                </div>
              </fieldset>
            ) : <p className="helper-copy">Choose a step in the sequence to edit its name, action, locator and timing.</p>}
          </div>
        </aside>

        <section className="panel studio-panel" aria-label="Editing canvas">
          <div className="studio-heading">
            <div>
              <p className="section-kicker">Edit suite</p>
              <h2>Canvas <span className="canvas-live-dot" aria-hidden="true" /> <span className="canvas-label">{hasMediaPreview ? 'Raw preview' : 'Structure view'}</span></h2>
            </div>
            <span className="viewport-chip">{project.viewport.width} × {project.viewport.height}</span>
          </div>

          <fieldset className="fieldset-reset studio-fieldset" disabled={lockWorkspace}>
            <div className="stage-desk">
              <div className="stage-frame" style={{ aspectRatio: `${Math.max(1, project.viewport.width)} / ${Math.max(1, project.viewport.height)}` }} aria-label={`Editing surface ${project.viewport.width} by ${project.viewport.height}`}>
                {!hasMediaPreview && <>
                  <div className="stage-grid" aria-hidden="true" />
                  <div className="stage-copy">
                    <span className="stage-chip">Editing surface</span>
                    <strong>{previewLoading ? 'Loading local replay media' : 'A replay adds media here'}</strong>
                    <p>Project dimensions and edit geometry are shown here. Record or replay this workflow to load local media.</p>
                  </div>
                </>}
                {showingVideo && preview?.video && <video
                  key={`${previewRevision}:${preview.video}`}
                  className="stage-media"
                  src={preview.video}
                  controls
                  preload="metadata"
                  aria-label="Raw replay video before masks"
                  onTimeUpdate={(event) => setMediaTimeMs(event.currentTarget.currentTime * 1000)}
                />}
                {!showingVideo && selectedScreenshot && <img
                  key={`${previewRevision}:${selectedScreenshot.url}`}
                  className="stage-media"
                  src={selectedScreenshot.url}
                  alt={`Raw screenshot before masks${selectedScreenshot.step ? `: ${selectedScreenshot.step.name}` : ''}`}
                />}
                {activeCrop && <div
                  className="crop-outline"
                  aria-label="Crop region"
                  style={{ left: `${(activeCrop.x / project.viewport.width) * 100}%`, top: `${(activeCrop.y / project.viewport.height) * 100}%`, width: `${(activeCrop.width / project.viewport.width) * 100}%`, height: `${(activeCrop.height / project.viewport.height) * 100}%` }}
                ><span>Crop</span></div>}
                {(hasMediaPreview ? visibleMasks : project.edits.masks).map((mask, index) => <div
                  className="mask-overlay"
                  key={mask.id}
                  aria-label={`Opaque mask ${project.edits.masks.findIndex((item) => item.id === mask.id) + 1}`}
                  style={{ left: `${(mask.x / project.viewport.width) * 100}%`, top: `${(mask.y / project.viewport.height) * 100}%`, width: `${(mask.width / project.viewport.width) * 100}%`, height: `${(mask.height / project.viewport.height) * 100}%` }}
                ><span>Hidden</span></div>)}
              </div>
              {hasMediaPreview && <div className="preview-caption"><strong>Raw capture before masks</strong><span>Black overlays show masks at the selected time; export applies the project edits.</span></div>}
              {previewImages.length > 0 && <div className="screenshot-strip" role="group" aria-label="Captured screenshots">
                {preview?.video && <button className={`screenshot-choice screenshot-choice--video ${showingVideo ? 'screenshot-choice--selected' : ''}`} type="button" aria-label="Show replay video" aria-pressed={showingVideo} onClick={() => { setSelectedScreenshotIndex(null); setMediaTimeMs(0); }}>
                  <span className="screenshot-choice__video-icon" aria-hidden="true">▶</span><span>Video</span>
                </button>}
                {previewImages.map((screenshot) => {
                  const selected = selectedScreenshot?.index === screenshot.index && !showingVideo;
                  return <button
                    className={`screenshot-choice ${selected ? 'screenshot-choice--selected' : ''}`}
                    type="button"
                    key={screenshot.url}
                    aria-label={`Show screenshot for ${screenshot.step?.name ?? `step ${screenshot.index + 1}`}`}
                    aria-pressed={selected}
                    onClick={() => { setSelectedScreenshotIndex(screenshot.index); setMediaTimeMs(screenshot.step?.endMs ?? 0); }}
                  >
                    <img src={screenshot.url} alt="" loading="lazy" />
                    <span>{screenshot.step?.name ?? `Step ${screenshot.index + 1}`}</span>
                  </button>;
                })}
              </div>}
            </div>

            <div className="viewport-fields">
              <label className="field">
                <span>Viewport width</span>
                <input aria-label="Viewport width" type="number" min="160" max="4096" step="1" aria-invalid={!isIntegerBetween(project.viewport.width, 160, 4096)} value={project.viewport.width} onChange={(event) => { const width = numericInput(event.currentTarget.value); editProject((current) => ({ ...current, viewport: { ...current.viewport, width } })); }} />
                <small className="field-hint">160–4,096 px · whole numbers</small>
              </label>
              <span className="dimension-separator" aria-hidden="true">×</span>
              <label className="field">
                <span>Viewport height</span>
                <input aria-label="Viewport height" type="number" min="120" max="4096" step="1" aria-invalid={!isIntegerBetween(project.viewport.height, 120, 4096)} value={project.viewport.height} onChange={(event) => { const height = numericInput(event.currentTarget.value); editProject((current) => ({ ...current, viewport: { ...current.viewport, height } })); }} />
                <small className="field-hint">120–4,096 px · whole numbers</small>
              </label>
            </div>

            <section className="timeline" aria-label="Edit timeline">
              <div className="timeline-heading">
                <div><p className="section-kicker">Timing and layers</p><h3>Timeline</h3></div>
                <span className="timeline-duration">{formatTime(timelineEnd)}</span>
              </div>
              <div className="trim-fields">
                <label className="field">
                  <span>Trim from (ms)</span>
                  <input type="number" min="0" value={project.edits.trimStartMs} onChange={(event) => updateEdit('trimStartMs', numericInput(event.currentTarget.value))} />
                </label>
                <label className="field">
                  <span>Trim to (ms)</span>
                  <input type="number" min="0" placeholder="End of replay" value={project.edits.trimEndMs ?? ''} onChange={(event) => updateEdit('trimEndMs', event.currentTarget.value === '' ? undefined : numericInput(event.currentTarget.value))} />
                </label>
              </div>
              <div className="track-list" aria-label="Timed edit layers">
                <div className="track-row"><span>Privacy masks</span><div className="track-rail">{project.edits.masks.map((mask, index) => <span className="track-bar track-bar--mask" key={mask.id} style={trackStyle(mask.startMs, mask.endMs, timelineEnd)} title={`Mask ${index + 1}: ${formatTime(mask.startMs)} to ${formatTime(mask.endMs)}`} />)}{project.edits.masks.length === 0 && <span className="track-empty">No masks</span>}</div></div>
                <div className="track-row"><span>Subtitles</span><div className="track-rail">{project.edits.annotations.map((annotation) => <span className="track-bar track-bar--caption" key={annotation.id} style={trackStyle(annotation.startMs, annotation.endMs, timelineEnd)} title={annotation.text} />)}{project.edits.annotations.length === 0 && <span className="track-empty">No subtitles</span>}</div></div>
                <div className="track-row"><span>Zooms</span><div className="track-rail">{project.edits.zooms.map((zoom, index) => <span className="track-bar track-bar--zoom" key={`${zoom.startMs}-${zoom.endMs}-${index}`} style={trackStyle(zoom.startMs, zoom.endMs, timelineEnd)} title={`Zoom ${zoom.scale}×`} />)}{project.edits.zooms.length === 0 && <span className="track-empty">No zooms</span>}</div></div>
                <div className="track-row"><span>Audio</span><div className="track-rail">{project.edits.audio ? <span className="track-marker track-marker--audio" role="img" aria-label={`${fileName(project.edits.audio.file)} starts at ${formatTime(project.edits.audio.startMs)} at ${Math.round(project.edits.audio.volume * 100)}% volume`} title={`${fileName(project.edits.audio.file)} · starts at ${formatTime(project.edits.audio.startMs)} · ${Math.round(project.edits.audio.volume * 100)}% volume`} style={{ left: `${Math.min(100, (project.edits.audio.startMs / timelineEnd) * 100)}%` }} /> : <span className="track-empty">No audio</span>}</div></div>
              </div>
            </section>
          </fieldset>

          <div className="privacy-note" role="note">
            <span className="privacy-note__icon" aria-hidden="true">!</span>
            <p><strong>Local recordings can contain sensitive information.</strong> Add opaque masks for private areas, then review the finished recording before export.</p>
          </div>
        </section>

        <aside className="panel controls-panel" aria-label="Project controls">
          <section className="control-section record-section">
            <div className="panel-heading panel-heading--compact">
              <div><p className="section-kicker">Capture</p><h2>Record a workflow</h2></div>
              <span className={`record-indicator ${recording ? 'record-indicator--active' : ''}`} aria-label={recording ? 'Recording' : 'Not recording'} />
            </div>
            <label className="field">
              <span>Starting URL</span>
              <input type="url" value={recordUrl} placeholder="https://example.com" onChange={(event) => setRecordUrl(event.currentTarget.value)} disabled={lockWorkspace} />
            </label>
            {recording ? <div className="recording-actions">
              <button className="button button--record-stop" type="button" onClick={stopRecording} disabled={isBusy || cancelling}>Stop recording</button>
              <button className="button button--quiet" type="button" onClick={cancelCurrent} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Cancel'}</button>
            </div> : <button className="button button--record" type="button" onClick={startRecording} disabled={lockWorkspace || recordUrl.trim().length === 0}>
              <span className="record-button-dot" aria-hidden="true" /> Start recording
            </button>}
            <p className="helper-copy">A separate browser window opens for capture. Stop to bring the steps into this editor.</p>
          </section>

          <section className="control-section replay-section">
            <div className="panel-heading panel-heading--compact">
              <div><p className="section-kicker">Run</p><h2>Replay workflow</h2></div>
              {runResult && <span className={`run-pill run-pill--${runResult.status}`}>{runResult.status === 'passed' ? 'Passed' : 'Failed'}</span>}
            </div>
            {project.variables.length > 0 ? <div className="runtime-fields">
              <p className="helper-copy">Enter values for this run. Secret values are cleared when replay ends.</p>
              {project.variables.map((variable) => <label className="field" key={variable.name}>
                  <span>{variable.description || variable.name}{variable.secret && <span className="secret-mark" aria-hidden="true">Secret</span>}</span>
                <input
                  type={variable.secret ? 'password' : 'text'}
                  aria-label={variable.description || variable.name}
                  autoComplete="off"
                  value={Object.hasOwn(runtimeValues, variable.name) ? runtimeValues[variable.name] : ''}
                  onChange={(event) => { const value = event.currentTarget.value; setRuntimeValues((current) => ({ ...current, [variable.name]: value })); }}
                  disabled={lockWorkspace}
                />
              </label>)}
            </div> : <p className="helper-copy">This project has no runtime values to enter.</p>}
            <fieldset className="fieldset-reset" disabled={lockWorkspace}>
              <details className="edit-disclosure variable-manager">
                <summary>Manage runtime variables <span className="disclosure-count">{project.variables.length}</span></summary>
                <p className="helper-copy">Use variables for URLs, form values, and other run-time inputs. Mark access tokens and credentials as secret.</p>
                <label className="field">
                  <span>Variable name</span>
                  <input maxLength={64} value={variableDraft.name} placeholder="shareToken" onChange={(event) => { const name = event.currentTarget.value; setVariableDraft((current) => ({ ...current, name })); }} />
                </label>
                <label className="field">
                  <span>Variable description</span>
                  <input maxLength={2000} value={variableDraft.description} placeholder="Shared report URL" onChange={(event) => { const description = event.currentTarget.value; setVariableDraft((current) => ({ ...current, description })); }} />
                </label>
                <label className="review-check review-check--compact">
                  <input type="checkbox" checked={variableDraft.secret} onChange={(event) => { const secret = event.currentTarget.checked; setVariableDraft((current) => ({ ...current, secret })); }} />
                  <span>Secret variable</span>
                </label>
                <button className="button button--outline button--full" type="button" onClick={addRuntimeVariable} disabled={!variableDraft.name.trim() || project.variables.length >= 500}>Add variable</button>
                {project.variables.length > 0 && <ul className="layer-list variable-list">{project.variables.map((variable) => {
                  const used = project.steps.some((step) => step.variable === variable.name);
                  return <li key={variable.name}>
                    <span>{variable.description || variable.name}</span>
                    <label className="review-check review-check--compact variable-secret-toggle">
                      <input type="checkbox" aria-label={`Mark ${variable.name} as secret`} checked={variable.secret} onChange={(event) => { const secret = event.currentTarget.checked; updateRuntimeVariableSecret(variable.name, secret); }} />
                      <span>Secret</span>
                    </label>
                    <button type="button" className="text-button" aria-label={`Remove runtime variable ${variable.name}`} title={used ? 'Switch its step to a literal before removing it' : 'Remove variable'} disabled={used} onClick={() => removeRuntimeVariable(variable.name)}>Remove</button>
                  </li>;
                })}</ul>}
              </details>
            </fieldset>
            <button className="button button--primary replay-button" type="button" onClick={replayWorkflow} disabled={lockWorkspace || project.steps.length === 0}>
              {busy === 'replay' ? cancelling ? 'Cancelling…' : 'Replaying…' : 'Replay workflow'}
            </button>
            {canCancel && <button className="button button--quiet cancel-button" type="button" onClick={cancelCurrent}>Cancel current operation</button>}

            <section className="progress-box" aria-label="Replay progress" role="region">
              <div className="progress-box__heading"><h3>Replay progress</h3>{busy === 'replay' ? <span>{cancelling ? 'Cancelling' : 'Running'}</span> : runResult ? <span>{runResult.status === 'passed' ? 'Passed' : 'Failed'}</span> : <span>Ready</span>}</div>
              {runResult?.video && <p className="progress-video">Captured video: <code>{fileName(runResult.video)}</code></p>}
              {runResult?.steps.length ? <ol className="result-list">
                {runResult.steps.map((result) => <li className={`result-row result-row--${result.status}`} key={result.id}>
                  <span className="result-row__mark" aria-hidden="true">{result.status === 'passed' ? '✓' : result.status === 'failed' ? '!' : '·'}</span>
                  <span className="result-row__body"><strong>{result.name}</strong><span>{result.status === 'passed' ? `${formatTime(result.endMs - result.startMs)} · Passed` : result.status === 'failed' ? 'Failed' : 'Not run'}</span>{result.error && <em>{result.error}</em>}</span>
                </li>)}
              </ol> : Object.values(progress).length > 0 ? <ol className="result-list">
                {Object.values(progress).map((result) => <li className={`result-row result-row--${result.status}`} key={result.id}>
                  <span className="result-row__mark" aria-hidden="true">{result.status === 'passed' ? '✓' : result.status === 'failed' ? '!' : '·'}</span>
                  <span className="result-row__body"><strong>{result.name}</strong><span>{result.status === 'failed' ? 'Failed' : result.status === 'passed' ? 'Passed' : 'Running'}</span>{result.error && <em>{result.error}</em>}</span>
                </li>)}
              </ol> : <p className="progress-empty">Run the workflow to see each step and any named error here.</p>}
            </section>
          </section>

          <section className="control-section output-section">
            <div className="panel-heading panel-heading--compact">
              <div><p className="section-kicker">Deliver</p><h2>Export</h2></div>
            </div>
            <fieldset className="fieldset-reset" disabled={lockWorkspace}>
              <div className="format-list" aria-label="Export formats">
                {exportChoices.map((choice) => <label className="format-option" key={choice.value}>
                  <input type="checkbox" checked={exportFormats.includes(choice.value)} onChange={(event) => setExportFormat(choice.value, event.currentTarget.checked)} />
                  <span>{choice.label}</span>
                </label>)}
              </div>
              <label className="review-check">
                <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.currentTarget.checked)} />
                <span>I reviewed the recording and its redactions</span>
              </label>
              <button className="button button--export" type="button" onClick={exportProject} disabled={lockWorkspace || !reviewed || exportFormats.length === 0}>
                {busy === 'export' ? 'Exporting…' : 'Export selected formats'}
              </button>
            </fieldset>
            <p className="helper-copy">Review is required before every export. Raw recordings stay on this device.</p>
          </section>

          <section className="control-section inspector-section">
            <div className="panel-heading panel-heading--compact">
              <div><p className="section-kicker">Finishing</p><h2>Edit layers</h2></div>
            </div>
            <fieldset className="fieldset-reset" disabled={lockWorkspace}>
              <details className="edit-disclosure" open>
                <summary>Crop and cursor</summary>
                <label className="review-check review-check--compact">
                  <input type="checkbox" checked={Boolean(project.edits.crop)} onChange={(event) => updateEdit('crop', event.currentTarget.checked ? { x: 0, y: 0, width: project.viewport.width, height: project.viewport.height } : undefined)} />
                  <span>Crop output</span>
                </label>
                {activeCrop && <div className="field-grid field-grid--two">
                  {(['x', 'y', 'width', 'height'] as const).map((key) => <label className="field" key={key}>
                    <span>Crop {key}</span>
                    <input type="number" min="0" value={activeCrop[key]} onChange={(event) => updateCrop(key, numericInput(event.currentTarget.value))} />
                  </label>)}
                </div>}
                <label className="review-check review-check--compact">
                  <input type="checkbox" checked={project.edits.cursorHighlight} onChange={(event) => updateEdit('cursorHighlight', event.currentTarget.checked)} />
                  <span>Highlight cursor</span>
                </label>
              </details>

              <details className="edit-disclosure">
                <summary>Opaque privacy masks <span className="disclosure-count">{project.edits.masks.length}</span></summary>
                <p className="helper-copy">Masks cover selected screen coordinates during the time range. They export as solid blocks.</p>
                <div className="field-grid field-grid--two">
                  {(['x', 'y', 'width', 'height'] as const).map((key) => <label className="field" key={key}>
                    <span>{key === 'x' || key === 'y' ? `${key} position (px)` : `${key} (px)`}</span>
                    <input type="number" min="0" value={maskDraft[key]} onChange={(event) => { const value = event.currentTarget.value; setMaskDraft((current) => ({ ...current, [key]: value })); }} />
                  </label>)}
                  <label className="field"><span>Mask starts (ms)</span><input type="number" min="0" value={maskDraft.startMs} onChange={(event) => { const value = event.currentTarget.value; setMaskDraft((current) => ({ ...current, startMs: value })); }} /></label>
                  <label className="field"><span>Mask ends (ms)</span><input type="number" min="0" value={maskDraft.endMs} onChange={(event) => { const value = event.currentTarget.value; setMaskDraft((current) => ({ ...current, endMs: value })); }} /></label>
                </div>
                <button className="button button--outline button--full" type="button" onClick={addMask}>Add opaque mask</button>
                {project.edits.masks.length > 0 && <ul className="layer-list">{project.edits.masks.map((mask, index) => <li key={mask.id}><span>Mask {index + 1} · {formatTime(mask.startMs)}–{formatTime(mask.endMs)}</span><button type="button" className="text-button" onClick={() => removeMask(mask.id)}>Remove</button></li>)}</ul>}
              </details>

              <details className="edit-disclosure">
                <summary>Subtitles and annotations <span className="disclosure-count">{project.edits.annotations.length}</span></summary>
                <label className="field"><span>Caption text</span><textarea rows={2} value={annotationDraft.text} onChange={(event) => { const value = event.currentTarget.value; setAnnotationDraft((current) => ({ ...current, text: value })); }} placeholder="Describe the action" /></label>
                <div className="field-row">
                  <label className="field"><span>Starts (ms)</span><input type="number" min="0" value={annotationDraft.startMs} onChange={(event) => { const value = event.currentTarget.value; setAnnotationDraft((current) => ({ ...current, startMs: value })); }} /></label>
                  <label className="field"><span>Ends (ms)</span><input type="number" min="0" value={annotationDraft.endMs} onChange={(event) => { const value = event.currentTarget.value; setAnnotationDraft((current) => ({ ...current, endMs: value })); }} /></label>
                </div>
                <button className="button button--outline button--full" type="button" onClick={addAnnotation} disabled={!annotationDraft.text.trim()}>Add subtitle</button>
                {project.edits.annotations.length > 0 && <ul className="layer-list">{project.edits.annotations.map((annotation) => <li key={annotation.id}><span>{annotation.text} · {formatTime(annotation.startMs)}–{formatTime(annotation.endMs)}</span><button type="button" className="text-button" onClick={() => updateEdit('annotations', project.edits.annotations.filter((item) => item.id !== annotation.id))}>Remove</button></li>)}</ul>}
              </details>

              <details className="edit-disclosure">
                <summary>Zoom moments <span className="disclosure-count">{project.edits.zooms.length}</span></summary>
                <div className="field-grid field-grid--two">
                  <label className="field"><span>Scale</span><input type="number" min="1" step="0.1" value={zoomDraft.scale} onChange={(event) => { const value = event.currentTarget.value; setZoomDraft((current) => ({ ...current, scale: value })); }} /></label>
                  <label className="field"><span>Center X</span><input type="number" value={zoomDraft.x} onChange={(event) => { const value = event.currentTarget.value; setZoomDraft((current) => ({ ...current, x: value })); }} /></label>
                  <label className="field"><span>Center Y</span><input type="number" value={zoomDraft.y} onChange={(event) => { const value = event.currentTarget.value; setZoomDraft((current) => ({ ...current, y: value })); }} /></label>
                  <label className="field"><span>Starts (ms)</span><input type="number" min="0" value={zoomDraft.startMs} onChange={(event) => { const value = event.currentTarget.value; setZoomDraft((current) => ({ ...current, startMs: value })); }} /></label>
                  <label className="field"><span>Ends (ms)</span><input type="number" min="0" value={zoomDraft.endMs} onChange={(event) => { const value = event.currentTarget.value; setZoomDraft((current) => ({ ...current, endMs: value })); }} /></label>
                </div>
                <button className="button button--outline button--full" type="button" onClick={addZoom}>Add zoom moment</button>
                {project.edits.zooms.length > 0 && <ul className="layer-list">{project.edits.zooms.map((zoom, index) => <li key={`${zoom.startMs}-${zoom.endMs}-${index}`}><span>{zoom.scale}× · {formatTime(zoom.startMs)}–{formatTime(zoom.endMs)}</span><button type="button" className="text-button" onClick={() => updateEdit('zooms', project.edits.zooms.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></li>)}</ul>}
              </details>

              <details className="edit-disclosure">
                <summary>Supplied audio</summary>
                <label className="field"><span>Audio file path</span><input value={audioDraft.file} placeholder="C:\\Demos\\narration.wav" onChange={(event) => { const value = event.currentTarget.value; setAudioDraft((current) => ({ ...current, file: value })); }} /></label>
                <div className="field-row">
                  <label className="field"><span>Starts (ms)</span><input type="number" min="0" value={audioDraft.startMs} onChange={(event) => { const value = event.currentTarget.value; setAudioDraft((current) => ({ ...current, startMs: value })); }} /></label>
                  <label className="field"><span>Volume</span><input type="number" min="0" max="1" step="0.05" value={audioDraft.volume} onChange={(event) => { const value = event.currentTarget.value; setAudioDraft((current) => ({ ...current, volume: value })); }} /></label>
                </div>
                <button className="button button--outline button--full" type="button" onClick={() => updateEdit('audio', audioDraft.file.trim() ? { file: audioDraft.file.trim(), startMs: numericInput(audioDraft.startMs), volume: numericInput(audioDraft.volume) } : undefined)} disabled={!audioDraft.file.trim()}>{project.edits.audio ? 'Update audio layer' : 'Use this audio file'}</button>
                {project.edits.audio && <p className="audio-status">Using {fileName(project.edits.audio.file)} from {formatTime(project.edits.audio.startMs)} at {Math.round(project.edits.audio.volume * 100)}% volume. <button type="button" className="text-button" onClick={() => updateEdit('audio', undefined)}>Remove</button></p>}
              </details>
            </fieldset>
          </section>
        </aside>
      </main>

      <footer className="status-footer" aria-live="polite">
        <span><span className={`footer-dot ${recording ? 'footer-dot--recording' : ''}`} />{recording ? 'Recording in progress' : isBusy ? busyLabel(busy) : 'Local workspace'}</span>
        <span>{dirty ? 'Unsaved changes' : projectFile ? `Saved · ${fileName(projectFile)}` : 'New project'}</span>
        {canCancel && <button className="footer-cancel" type="button" onClick={cancelCurrent}>Cancel operation</button>}
      </footer>
    </div>
  );
}

function busyLabel(busy: BusyAction | null) {
  if (!busy) return 'Local workspace';
  const labels: Record<BusyAction, string> = {
    new: 'Creating project…',
    open: 'Opening project…',
    save: 'Saving project…',
    startRecording: 'Starting recording…',
    stopRecording: 'Finishing recording…',
    replay: 'Replaying workflow…',
    export: 'Exporting files…',
    installBrowser: 'Installing browser…',
  };
  return labels[busy];
}

export default App;
