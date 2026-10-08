# DemoForge beta/v1 release review

Review date: 2026-10-08  
Public source reviewed: `2f07155286e2d1e9553d1c198407a19d8d232c9e` (`main`)  
Scope: media effects and masking, secret persistence, project/run consistency and media paths, format versions, Electron IPC and preview protocol, cancellation cleanup, and renderer controls. Review fixtures use synthetic local data only.

## Findings

### [P2] A stale run can be paired with an edited workflow

`src/core/run.ts:18` compares only the count and ordered IDs of the run steps with the supplied project. It does not compare the workflow target/action or a workflow fingerprint. The Electron path holds a fingerprint in memory (`src/electron/main.ts:24`), but the CLI loads `project` and `run.json` independently. A run from a workflow that navigated to one site is therefore accepted with a same-named project that reuses the step ID and changes the target. Export then uses the supplied project’s masks and descriptions against the unrelated capture.

Regression evidence: `tests/release-review/run-binding.test.ts` creates a run inside its capture directory, changes only the project’s navigation target, and expects `loadRun()` to reject the mismatch. It fails on the reviewed source because the run is accepted. The run format needs provenance that binds it to the workflow fields used for capture/replay; changing the run schema requires an explicit compatibility decision for existing version-one reports.

### [P2] Sensitive URL query values are written into project files

`src/browser/runner.ts` stores the supplied start URL as the first navigation step target, and navigation normalization preserves its query string. A URL such as `...?access_token=...` therefore puts that credential in the project JSON saved by the user. The current privacy text covers heuristic form-field detection and raw media, but does not disclose that sensitive query parameters are retained.

Regression evidence: `tests/release-review/recording-url-secret.test.ts` records a synthetic local URL with an `access_token` canary and asserts that the project does not contain the canary. It fails with the full token in `steps[0].target`. A fix should keep replay behavior usable while preventing silent persistence, for example by supporting a runtime URL parameter or by clearly stopping/warning before the credential is saved.

### [P2] Cancel does not settle while Chromium launch is pending

`src/browser/runner.ts:276` awaits `chromium.launch()` before attaching the abort listener at line 284. The service cancel handler aborts and then awaits `recordingStartup` (`src/service/main.ts:13-17`), so a stalled launch leaves the user-facing cancel request pending. `BrowserService.close()` now has a bounded wait, but the normal editor cancel request does not use that shutdown bound.

Regression evidence: `tests/release-review/recording-launch-cancel.test.ts` substitutes a launch promise that remains pending, aborts startup, and requires cancellation to settle before that promise resolves. It fails on the reviewed source. The test then releases the fake launch and confirms the late browser is closed.

### [P2] Timed masks can miss duplicated frames at a redaction boundary

At the reviewed source, `src/media/export.ts` applied mask filters before the 25 fps normalization added for zoom effects in `src/media/effects.ts:169`. With a lower-cadence source, FFmpeg could duplicate a source frame whose mask was inactive into output frames after the mask start time.

Regression evidence: `tests/release-review/media-mask-cadence.test.ts` creates a 10 fps synthetic clip with a blue canary, enables zoom normalization, and starts the black mask at 620 ms. The exported frame at 640 ms contains the canary (maximum sampled RGB value 254; expected below 15).

The shared working tree now contains a pending `src/media/export.ts` change that normalizes before timed masks. The same regression passes against that change (1/1). Treat this as an in-progress fix until the final exporter diff and the required export checks are reviewed; the current patch also inserts `fps=25` when `buildEffects()` may insert the same normalization for zooms.

## Controls and release evidence

- Electron IPC is restricted to the exact local editor URL and main frame. The renderer is sandboxed with context isolation and Node integration disabled; permissions, navigation, popups, and webviews are denied. Preview requests resolve only through the main-process URL-to-file map, and the renderer checks the local preview URL shape. I found no reproducible IPC or arbitrary-file preview bypass in these paths.
- Project and run data reject unknown schema versions and unrecognized fields. Project and run input sizes are bounded, and CLI media paths are resolved under the run directory. The run/workflow binding gap above remains despite those protections.
- Recorded password and heuristically sensitive form values become variable references; the canary test covers a URL query token that bypasses that mechanism. Raw video and screenshots remain sensitive local artifacts as disclosed in the README and security notes.
- Mask position, size, and time are edited through numeric fields. The canvas previews the raw capture with overlay masks; it does not show a rendered final export or provide drag-to-draw mask editing. This is a usability limitation for precise redaction review, though the source review did not establish a separate data-integrity failure from the controls themselves.
- Existing evidence is stale in places: `docs/review-media.md` says effect export is unsupported, while `docs/verification.md` says effects are not connected to exports. Current `src/media/export.ts` and media tests do compose those effects. Refresh those notes before using them as release evidence.
- Strict version-one parsing is present, but package/install validation and an upgrade compatibility corpus are outside this source review. Do not treat this review as v1 acceptance or production-readiness evidence.

## Verification performed

- The four tests under `tests/release-review/` were run on Windows with the local synthetic FFmpeg executable. Against the reviewed source, three fail as expected: run binding, pending-launch cancellation, and URL query secret persistence. The timed-mask test failed against the reviewed source and passed after the pending exporter change.
- `npm run typecheck` is currently blocked by a separate in-progress packaging test error: `tests/packaging/license-inventory.test.ts(5,62)` cannot find a declaration for `scripts/license-inventory.mjs` (`TS7016`). No type errors were reported for the release-review tests.
- No package install, release build, full suite, Linux qualification, or v1 closure was performed as part of this review.
