# Verification evidence

2026-10-08: source MVP and beta hardening. This is not a v1 acceptance record.

| Scope | Evidence | State |
| --- | --- | --- |
| Current local Windows source | Fresh typecheck; `npm test` pretest build and 149/149 tests across 25 files at 19:58:49 Istanbul, including the caption mask-only regression | Passed on current local tree |
| Windows CI source | CI run 37810979656, commit `ba71d08`: typecheck and build passed; `npm test` passed 148/148 across 24 files | Passed |
| Linux CI source | CI run 37810979656 stopped at the bounded apt media/display prerequisite timeout before typecheck, build, tests, audits, or packaging. Earlier Linux source tests at `d995eb3` had 143 passed and one Windows-only test skipped. | Current run unverified; earlier snapshot passed |
| Windows CI archive | Fresh extraction from `ba71d08`, SHA-256 `f6691b807b6090d8f0ac1a448bc0f0b9eb2a2bdb392d9f885b69af3bc95cc5c0`; package smoke covered setup, project round-trip, five-step recording/replay, masked exports and reopening | Passed; predates the corrected caption pixel crop |
| Local preview archive | ZIP SHA-256 `4F8D3D1C88E9AF2A9D63000AE7305DE1B0A04444A3B8437FB80A7FC7236DA5DC`; `artifacts/package-acceptance-caption.log` reran it with the corrected harness, clean profile and no inherited CA flags | Passed with the current caption check; archive binary predates the harness-only correction |
| Current CI package gates | Windows CI archive has not run the corrected caption check; Linux CI stopped before tests or package acceptance | Pending |
| Production dependency audit | Both audits passed in Windows CI run 37810979656 | Passed at `ba71d08` |
| Full build-tool audit | Eight moderate sprintf-js reports; no high/critical | Known tooling limitation |
| Final independent review and v1 release | Required after fresh platform package acceptance | Pending |

[Latest CI run](https://github.com/Pastalikek65/demoforge/actions/runs/37810979656). Development host: Windows x64, Node 24.21.0, Electron 44.7.0, Playwright 1.64.0, external FFmpeg 7.1 with libx264. Timing above is a test-suite observation, not a product benchmark. [Representative workflow measurements](performance.md) state their dataset and measurement scope.

`artifacts/source-acceptance-caption.log` is the current local source run after the caption-pixel correction: typecheck passed, the pretest build passed, and all 149 tests across 25 files passed. The suite exercises real Chromium recordings, five-step built CLI replay, actual Electron/preload/child browser replay, allowlisted raw media preview, FFmpeg MP4/GIF decoding, opaque mask pixels in video and regenerated guide images, timed mask cadence, zoom/captions/cursor/audio composition, secret field and URL variable serialization, malformed and oversized files, cancellation, atomic output cleanup, and unchanged existing files. Windows directory junctions exercise media escape rejection without requiring file-symlink privileges.

Independent beta regressions drove fixes for stale same-ID workflow reports, secret URL persistence, cancelled recording launches, low-frame-rate timed redaction, and valid Windows short/long path aliases. Run reports require a SHA-256 workflow fingerprint. Old pre-release reports missing it must be replayed; ordinary version-one projects remain readable; older literal secret-URL projects require conversion to runtime URL variables. Presentation edits retain the replay fingerprint; behavior edits require replay.

A built-runtime check found an extensionless module import missed by Bundler resolution. It was fixed, and backend compilation now uses NodeNext resolution so equivalent relative-import mistakes fail the build. The fresh full suite verifies compiled CLI and Electron behavior after the correction.

Independent package review found that Playwright's default browser launch disables Chromium's OS sandbox. Both recording and replay now request `chromiumSandbox: true`; two regression tests first failed against the previous launches, then passed after the fix. Actual Windows recordings and replay also pass with that setting. Electron tests now use their own verified temporary user-data profiles and request sandboxing explicitly. The Linux smoke harness reads Seccomp mode and namespace IDs for the Electron and workflow renderers; the recorded namespace IDs are observations, not evidence that those namespaces differ from the app or host.

Browser setup now uses system trust explicitly even when packaged Electron removes inherited Node flags. Closing the editor aborts setup and waits for cleanup of its owned installer process tree. Nine synthetic lifecycle tests cover pre-abort, abort, timeout, success, fixed trusted download options, POSIX escalation, and unverified Windows cleanup failure. A controlled run of the timeout regression against the earlier committed implementation failed before the corrected implementation passed. Failure logs are retained locally; they are not successful acceptance evidence.

Earlier Windows package acceptance attempts failed because the harness selected three matching checkboxes, an export did not finish, and a later package exposed a missing-module import. Those failures remain part of the history, but later Windows acceptance at `ba71d08` passed. A subsequent regression showed that the caption pixel assertion could pass on an opaque mask without a caption. The assertion now inspects the unmasked bottom caption band; the regression failed before that change and passes afterward (`artifacts/caption-evidence-regression-red.log` and `artifacts/caption-evidence-regression-green.log`). The corrected harness now passes against the local preview archive (`artifacts/package-acceptance-caption.log`); that archive was built before the harness-only assertion change. A Windows CI run with the corrected check and Linux archive acceptance remain pending; the latest Linux CI job timed out during apt prerequisites before tests or packaging.

Author notes preserve earlier failures. User pilots, production deployments, download counts and star outcomes have not been claimed.
