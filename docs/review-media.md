# Media, service, and boundary review

Review date: 2026-10-08
Scope: `src/media/export.ts`, `src/electron/boundary.ts`, `src/service/**`, and the Electron/CLI call paths that reach them. This was a read-only source audit. The only added artifact is the service cancellation regression harness under `tests/review/`.

## Findings

### [P2] CLI export trusts unbounded, user-supplied run metadata

`src/cli.ts:47-52` reads the path supplied by `--run` without a byte limit, calls `JSON.parse`, then casts the result to `RunResult`. `src/media/export.ts:21-25` checks only `schemaVersion` and `status` before consuming it; the screenshot/video paths are only required to be absolute regular files by `localFile` at lines 13-15, with no relationship to the run folder. The export loop at lines 40-46 and 50-63 passes those paths to FFmpeg.

An attacker who can get a user to export a supplied `run.json` with `--reviewed` can direct the CLI to encode arbitrary readable image/video files into the chosen export folder. A forged run can also mismatch `project.steps` and `run.steps`, so the project’s masks and action descriptions can be applied to unrelated media or step timings. Large JSON input and oversized arrays/strings also have no pre-parse or schema bounds. The Electron UI does not take this raw-file path: `src/electron/main.ts:84-93` exports the in-memory run only after checking its workflow fingerprint.

Recommended fix: enforce a file-size cap before parsing, then strictly validate the complete run schema (known properties, finite bounded timings and coordinates, bounded steps/strings, and media path fields). Bind the run to the supplied project by checking step IDs/order and project identity/provenance. Resolve media paths and require them to be inside an explicitly selected run directory, or obtain explicit user confirmation for external media. For robust path checks, account for symlinks and avoid a check/use race when opening inputs.

### [P3] Cancel and service shutdown can wait indefinitely during Chromium launch

`src/browser/runner.ts:276-301` awaits `chromium.launch()` before installing the abort listener or checking the signal again. During that interval, `src/service/main.ts:13-17` aborts and then awaits `recordingStartup`, so cancel cannot reply until launch settles. `src/service/client.ts:29-35` has no request deadline, and `close()` waits for the cancel request before killing the child (the remaining method is at lines 37-39). If browser launch stalls, the cancel request and window shutdown can remain pending indefinitely.

The existing cancellation path handles startup after launch and navigation cancellation; the new test in `tests/review/service-cancel-start.test.ts` exercises cancellation while a local page response is held. It does not cover a stalled browser launch. Recommended fix: give service requests and shutdown a bounded deadline, kill the browser-service child if graceful cancellation misses it, and ensure any launch that resolves after cancellation is closed. Add a launch-stall regression case if the browser boundary can be made deterministic.

### [P3] Runtime variable limits disagree with the project contract and lack a total-size cap

`src/core/project.ts` accepts up to 500 variables and variable names beginning with `_`; `src/electron/boundary.ts:7,10` accepts at most 100 runtime values and requires the first character to be a letter. Thus a project-valid `_token` declaration cannot be supplied through Electron replay, and projects with more than 100 supplied variables cannot pass the runtime boundary. The per-value one-million-character limit at line 11 has no aggregate limit; 100 values can represent about 100 million UTF-16 code units before IPC copies and runtime overhead.

Recommended fix: use one shared identifier/count contract for project declarations and runtime values, and cap aggregate encoded bytes as well as individual values. Keep the runtime-value cap early enough in the boundary that it limits all downstream copies.

## Controls observed

- Electron IPC handlers require the exact editor URL and main frame (`src/electron/boundary.ts:1-3`, with the gate applied in `src/electron/main.ts:48-51`). The renderer is sandboxed with context isolation and no Node integration (`main.ts:34-37`); remote pages run in a separate Chromium process.
- Main-process export uses an in-memory successful run and checks a fingerprint over steps, viewport, and variable declarations before exporting (`src/electron/main.ts:14,84-93`). The user must explicitly mark the run reviewed.
- FFmpeg is invoked with `execFile`, not through a shell, with a timeout, bounded diagnostic buffer, and cancellation signal (`src/media/export.ts:16-19`). Export writes to a unique sibling staging directory and renames it only after generation succeeds (`export.ts:27-33,82-84`), which prevents partially generated exports from appearing at the destination.
- Strict project parsing at the main and CLI call sites validates mask geometry/times before those fields are interpolated into FFmpeg filters. I found no filter-injection path through these current call sites. `exportRun` itself trusts its typed `Project` argument, so keeping parsing at every external call boundary remains important.
- Media inputs reject non-absolute paths and symlinks/non-regular files (`export.ts:13-15`), but do not establish run-folder provenance; see the CLI finding above.
- CLI `record` and `replay` both create their output folders with `recursive: false` before writing artifacts (`src/cli.ts:18-20, 38`), so an already-existing destination is refused there.
- Guide output escapes HTML/Markdown and does not embed runtime variable values (`export.ts:8-9,70-80`). HTML uses a restrictive `default-src 'none'` policy.
- Export intentionally rejects zooms, annotations, audio, and cursor highlighting (`export.ts:26`). These remain unsupported editing features, not a security finding.

## Verification evidence and limits

- `npm run typecheck` passed before the latest promise-handling change; rerun after that edit is pending.
- `tests/review/service-cancel-start.test.ts` starts the real service entry point as a child, holds a local HTTP response, sends `cancel` while `record-start` is pending, and requires the start request to settle. It uses a temporary scratch directory by default and does not silently skip. The project owner reports that the settlement assertion passed on the first run, but Vitest exited with an unhandled `RECORDING_CANCELLED` rejection. The harness now immediately converts both fulfillment and rejection into a settled result; a rerun is pending. This reviewer did not execute app/tests because the selected security-audit skill requires an OS-enforced isolated sandbox for target-code execution.
- The project owner reported that four media tests pass when `DEMOFORGE_FFMPEG` is set to `C:\Users\mamid\AppData\Local\Programs\Python\Python312\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe`, and that browser tests pass including cancellation during slow local navigation. Those results were not independently reproduced here; an earlier missing-FFmpeg error without the environment variable is an environment prerequisite, not evidence of an app failure.
