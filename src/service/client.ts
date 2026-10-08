import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { StepResult } from '../shared/types.js';

export class BrowserService {
  private child: ChildProcess;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  onProgress?: (step: StepResult) => void;
  constructor() {
    this.child = fork(fileURLToPath(new URL('./main.js', import.meta.url)), [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true, execArgv: []
    });
    this.child.on('message', (message: any) => {
      if (message?.type === 'progress') { this.onProgress?.(message.step); return; }
      const request = this.pending.get(message?.id);
      if (!request) return;
      this.pending.delete(message.id);
      message.ok ? request.resolve(message.result) : request.reject(new Error(message.error ?? 'Browser operation failed.'));
    });
    const fail = () => {
      for (const request of this.pending.values()) request.reject(new Error('Browser process stopped. Restart the operation.'));
      this.pending.clear();
    };
    this.child.on('exit', fail);
    this.child.on('error', fail);
  }
  request<T>(command: string, input: unknown = {}): Promise<T> {
    if (!this.child.connected) return Promise.reject(new Error('Browser process is unavailable.'));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.send({ id, command, input }, (error) => {
        if (error) { this.pending.delete(id); reject(new Error('Cannot contact the browser process.')); }
      });
    });
  }
  async close(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([this.request('cancel'), new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]); }
    finally { if (timer) clearTimeout(timer); this.child.kill(); }
  }
}
