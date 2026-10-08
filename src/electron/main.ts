import { app, BrowserWindow, dialog, ipcMain, session, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createProject, loadProject, parseProject, saveProject } from '../core/project.js';
import { trustedSender, validateVariables } from './boundary.js';
import { BrowserService } from '../service/client.js';
import { exportRun } from '../media/export.js';
import { doctor } from '../doctor.js';
import { workflowHash } from '../core/fingerprint.js';
import { installBrowser } from './browser-setup.js';
import type { RunResult, Project, ExportOptions } from '../shared/types.js';

let window: BrowserWindow;
let service: BrowserService;
let run: RunResult | undefined;
let runWorkflow = '';
let projectFile: string | undefined;
let active = false;
let activeOperation: Promise<unknown> | undefined;
let exportAbort: AbortController | undefined;
let installAbort: AbortController | undefined;
let installing: Promise<void> | undefined;
const previewFiles = new Map<string, string>();
protocol.registerSchemesAsPrivileged([{ scheme: 'demoforge-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const index = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
const editorURL = pathToFileURL(index).href;
const fingerprint = workflowHash;
async function setupBrowser(directory: string): Promise<void> {
  installAbort = new AbortController();
  installing = installBrowser(directory, installAbort.signal);
  try { await installing; } finally { installing = undefined; installAbort = undefined; }
}
async function captureFolder(): Promise<string> {
  const parent = path.join(app.getPath('userData'), 'captures'); await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, 'run-'));
}
async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  if (active) throw new Error('Finish or cancel the current operation first.');
  active = true;
  try { const pending = operation(); activeOperation = pending; return await pending; }
  finally { activeOperation = undefined; active = false; }
}
app.whenReady().then(async () => {
  const browserDirectory = path.join(app.getPath('userData'), 'browser-runtime');
  if (app.isPackaged) process.env.PLAYWRIGHT_BROWSERS_PATH = browserDirectory;
  if (process.argv.includes('--install-browser')) {
    try { await setupBrowser(browserDirectory); app.exit(0); }
    catch (error) { console.error(error instanceof Error ? error.message : 'Browser setup failed.'); app.exit(1); }
    return;
  }
  protocol.handle('demoforge-media', request => {
    const file = previewFiles.get(request.url);
    return file ? net.fetch(pathToFileURL(file).href, { headers: request.headers }) : new Response('Preview not available', { status: 404 });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // The editor only loads packaged local assets. Remote web pages run in the separate Chromium process.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('devtools:') && !details.url.startsWith('demoforge-media:') }));
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 880, minHeight: 600, backgroundColor: '#f6f3ed',
    webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== editorURL) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  service = new BrowserService();
  service.onProgress = step => { if (!window.isDestroyed()) window.webContents.send('studio:progress', step); };
  const handle = (name: string, operation: (...args: any[]) => unknown) => ipcMain.handle(`studio:${name}`, (event, ...args) => {
    if (!trustedSender(event.senderFrame?.url ?? '', editorURL, event.senderFrame === event.sender.mainFrame)) throw new Error('Desktop actions require the local editor.');
    return operation(...args);
  });
  handle('newProject', () => { if (active) throw new Error('Finish the current operation first.'); run = undefined; runWorkflow = ''; projectFile = undefined; return createProject(); });
  handle('openProject', () => exclusive(async () => {
    const choice = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'DemoForge project', extensions: ['json'] }] });
    if (choice.canceled) return null;
    const project = await loadProject(choice.filePaths[0]); projectFile = choice.filePaths[0]; run = undefined; runWorkflow = '';
    return { project, file: projectFile };
  }));
  handle('saveProject', (input: unknown) => exclusive(async () => {
    const project = parseProject(input);
    const choice = await dialog.showSaveDialog(window, { defaultPath: projectFile ?? 'workflow.demoforge.json', filters: [{ name: 'DemoForge project', extensions: ['json'] }] });
    if (choice.canceled || !choice.filePath) return null;
    await saveProject(choice.filePath, project); projectFile = choice.filePath; return projectFile;
  }));
  handle('startRecording', (input: unknown) => exclusive(async () => {
    if (typeof input !== 'string' || input.length > 10000) throw new Error('Enter a valid starting URL.');
    const url = new URL(input); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) URL without embedded credentials.');
    run = undefined; runWorkflow = '';
    await service.request('record-start', { url: url.href, outputDir: await captureFolder() });
  }));
  handle('stopRecording', () => exclusive(async () => {
    const result = await service.request<{ project: Project; run: RunResult }>('record-stop');
    const project = parseProject(result.project); run = result.run; runWorkflow = fingerprint(project);
    return { project, run };
  }));
  handle('replay', (input: unknown, variables: unknown) => exclusive(async () => {
    const project = parseProject(input); run = undefined;
    const outputDir = await captureFolder();
    run = await service.request<RunResult>('replay', { project, options: { outputDir, headless: false, variables: validateVariables(variables) } });
    runWorkflow = fingerprint(project); await writeFile(path.join(outputDir, 'run.json'), JSON.stringify(run, null, 2));
    return run;
  }));
  handle('export', (input: unknown, formats: ExportOptions['formats'], reviewed: unknown) => exclusive(async () => {
    const project = parseProject(input);
    if (!run || fingerprint(project) !== runWorkflow) throw new Error('Replay this workflow successfully before exporting.');
    if (reviewed !== true) throw new Error('Review the recording and masks before exporting.');
    if (!Array.isArray(formats) || formats.some(format => !['mp4', 'gif', 'markdown', 'html'].includes(format))) throw new Error('Invalid output formats.');
    const choice = await dialog.showSaveDialog(window, { title: 'Choose a new export folder', defaultPath: 'demoforge-export' });
    if (choice.canceled || !choice.filePath) return { files: [], warnings: ['Export canceled.'] };
    exportAbort = new AbortController();
    try { return await exportRun(project, run, { outputDir: choice.filePath, formats, reviewed: true, signal: exportAbort.signal }); }
    finally { exportAbort = undefined; }
  }));
  handle('cancel', () => { exportAbort?.abort(); return service.request('cancel'); });
  handle('doctor', doctor);
  handle('installBrowser', () => exclusive(async () => {
    const { chromium } = await import('playwright');
    const cache = path.dirname(path.dirname(path.dirname(chromium.executablePath())));
    await setupBrowser(process.env.PLAYWRIGHT_BROWSERS_PATH ?? cache);
    return doctor();
  }));
  handle('getPreview', () => {
    previewFiles.clear();
    const revision = randomUUID();
    const addFile = (file: string, id: string) => { const url = `demoforge-media://capture/${revision}/${id}`; previewFiles.set(url, file); return url; };
    return { ...(run?.video ? { video: addFile(run.video, 'video') } : {}), screenshots: run?.steps.map((step, index) => step.screenshot ? addFile(step.screenshot, `step-${index}`) : '') ?? [] };
  });
  await window.loadFile(index);
});
app.on('window-all-closed', () => {
  exportAbort?.abort(); installAbort?.abort();
  void Promise.allSettled([service?.close(), installing, activeOperation]).finally(() => app.quit());
});
