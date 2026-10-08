// Public version-one contracts. Runtime validation lives in core/project.ts.
export type Action = 'navigate' | 'click' | 'fill' | 'select' | 'wait';
export interface Step {
  id: string;
  name: string;
  action: Action;
  target?: string;
  value?: string;
  variable?: string;
  timeoutMs: number;
  pauseMs: number;
}
export interface Variable { name: string; secret: boolean; description: string }
export interface Mask { id: string; x: number; y: number; width: number; height: number; startMs: number; endMs: number }
export interface Annotation { id: string; text: string; startMs: number; endMs: number }
export interface Project {
  schemaVersion: 1;
  name: string;
  viewport: { width: number; height: number };
  steps: Step[];
  variables: Variable[];
  edits: {
    trimStartMs: number;
    trimEndMs?: number;
    crop?: { x: number; y: number; width: number; height: number };
    masks: Mask[];
    annotations: Annotation[];
    zooms: { startMs: number; endMs: number; scale: number; x: number; y: number }[];
    cursorHighlight: boolean;
    audio?: { file: string; startMs: number; volume: number };
  };
}
export interface StepResult {
  id: string; name: string; status: 'passed' | 'failed' | 'not-run';
  startMs: number; endMs: number; screenshot?: string; error?: string;
}
export interface RunResult {
  schemaVersion: 1; status: 'passed' | 'failed'; projectName: string; workflowHash: string;
  startedAt: string; durationMs: number; video?: string;
  steps: StepResult[];
  cursor: { timeMs: number; x: number; y: number }[];
}
export interface ReplayOptions {
  outputDir: string; headless?: boolean; variables?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (step: StepResult) => void;
}
export interface RecordOptions { url: string; outputDir: string; viewport?: Project['viewport']; headless?: boolean; signal?: AbortSignal }
export interface RecordingSession { stop(): Promise<{ project: Project; run: RunResult }>; cancel(): Promise<void> }
export interface ExportOptions { outputDir: string; formats: ('mp4' | 'gif' | 'markdown' | 'html')[]; reviewed: boolean; ffmpegPath?: string; signal?: AbortSignal }
export interface ExportResult { files: string[]; warnings: string[] }
export interface StudioAPI {
  newProject(): Promise<Project>;
  openProject(): Promise<{ project: Project; file: string } | null>;
  saveProject(project: Project): Promise<string | null>;
  startRecording(url: string): Promise<void>;
  stopRecording(): Promise<{ project: Project; run: RunResult }>;
  replay(project: Project, variables: Record<string, string>): Promise<RunResult>;
  export(project: Project, formats: ExportOptions['formats'], reviewed: boolean): Promise<ExportResult>;
  cancel(): Promise<void>;
  doctor(): Promise<{ name: string; ok: boolean; detail: string }[]>;
  installBrowser(): Promise<{ name: string; ok: boolean; detail: string }[]>;
  getPreview(): Promise<{ video?: string; screenshots: string[] }>;
  onProgress(callback: (result: StepResult) => void): () => void;
}
