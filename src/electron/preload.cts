import { contextBridge, ipcRenderer } from 'electron';
const invoke = (name: string, ...args: unknown[]) => ipcRenderer.invoke(`studio:${name}`, ...args);
contextBridge.exposeInMainWorld('demoforge', {
  newProject: () => invoke('newProject'),
  openProject: () => invoke('openProject'),
  saveProject: (project: unknown) => invoke('saveProject', project),
  startRecording: (url: string) => invoke('startRecording', url),
  stopRecording: () => invoke('stopRecording'),
  replay: (project: unknown, variables: unknown) => invoke('replay', project, variables),
  export: (project: unknown, formats: unknown, reviewed: unknown) => invoke('export', project, formats, reviewed),
  cancel: () => invoke('cancel'),
  doctor: () => invoke('doctor'),
  getPreview: () => invoke('getPreview'),
  onProgress: (callback: (value: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('studio:progress', listener);
    return () => ipcRenderer.removeListener('studio:progress', listener);
  }
});
