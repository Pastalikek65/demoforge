import { replay, startRecording } from '../browser/runner.js';
import { parseProject } from '../core/project.js';
import { validateVariables } from '../electron/boundary.js';
import type { RecordingSession, RecordOptions, ReplayOptions } from '../shared/types.js';
let session: RecordingSession | undefined;
let abort: AbortController | undefined;
let busy = false;
let recordingStartup: Promise<RecordingSession> | undefined;
let generation = 0;
process.on('message', async (message: any) => {
  const { id, command, input } = message;
  try {
    if (command === 'cancel') {
      generation++;
      abort?.abort();
      try { await recordingStartup; } catch { /* Startup cancellation was handled by the original request. */ }
      await session?.cancel(); session = undefined;
      process.send?.({ id, ok: true }); return;
    }
    if (busy) throw new Error('A browser operation is already running.');
    busy = true;
    let result: unknown;
    if (command === 'record-start') {
      if (session) throw new Error('Recording already started.');
      const epoch = generation;
      abort = new AbortController();
      recordingStartup = startRecording({ ...input as RecordOptions, signal: abort.signal });
      try {
        const started = await recordingStartup;
        if (epoch !== generation) { await started.cancel(); throw new Error('Recording canceled.'); }
        session = started;
      } finally { recordingStartup = undefined; abort = undefined; }
    } else if (command === 'record-stop') {
      if (!session) throw new Error('No recording is running.');
      result = await session.stop(); session = undefined;
    } else if (command === 'replay') {
      if (session) throw new Error('Stop recording before replay.');
      abort = new AbortController();
      const options: ReplayOptions = { ...input.options, variables: validateVariables(input.options.variables ?? {}), signal: abort.signal,
        onProgress: step => process.send?.({ type: 'progress', step }) };
      result = await replay(parseProject(input.project), options);
      abort = undefined;
    } else throw new Error('Unsupported browser operation.');
    process.send?.({ id, ok: true, result });
  } catch (error) {
    // Never send raw Playwright errors; they can contain runtime secret values.
    process.send?.({ id, ok: false, error: error instanceof Error && !/playwright|locator|Call log/i.test(error.message) ? error.message : 'Browser operation failed. Inspect the step result.' });
  } finally { if (command !== 'cancel') busy = false; }
});
process.on('disconnect', () => { abort?.abort(); void session?.cancel().finally(() => process.exit(0)); if (!session) process.exit(0); });
