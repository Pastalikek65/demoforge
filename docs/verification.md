# Verification evidence

2026-10-08: source MVP and beta hardening. This is not a v1 acceptance record.

| Scope | Evidence | State |
| --- | --- | --- |
| Windows development source | Fresh full npm test: 143/143, 23/23 files, 21.45 seconds at 19:14 Istanbul; compiled CLI, isolated actual Electron profiles, sandboxed workflow Chromium, and installer lifecycle checks included | Passed at that source snapshot |
| Linux development source | CI 37792508969, commit 2f07155: Linux 72/72 | Passed for the earlier source snapshot |
| Windows beta archive | Fresh extraction of SHA-256 B9E3826D07298BE7D431C55201016A9AE5F73F4268A721F03BDFF71DBFFF625C; explicit first-run setup without inherited CA overrides, project round-trip, five-step replay, all-format masked export and reopening | Passed for the 19:00 archive, before final sandbox/lifecycle changes |
| Current source platform archives | Fresh extraction, real UI and all-format export acceptance in CI | Pending |
| Production dependency audit | No reported vulnerabilities | Passed at MVP/beta snapshot |
| Full build-tool audit | Eight moderate sprintf-js reports; no high/critical | Known tooling limitation |
| Final independent review and v1 release | Required after fresh platform package acceptance | Pending |

[Linux evidence run](https://github.com/Pastalikek65/demoforge/actions/runs/37792508969). Development host: Windows x64, Node 24.21.0, Electron 44.7.0, Playwright 1.64.0, external FFmpeg 7.1 with libx264. Timing above is a test-suite observation, not a product benchmark. [Representative workflow measurements](performance.md) state their dataset and measurement scope.

The suite exercises real Chromium recordings, five-step built CLI replay, actual Electron/preload/child browser replay, allowlisted raw media preview, FFmpeg MP4/GIF decoding, opaque mask pixels in video and regenerated guide images, timed mask cadence, zoom/captions/cursor/audio composition, secret field and URL variable serialization, malformed and oversized files, cancellation, atomic output cleanup, and unchanged existing files. Windows directory junctions exercise media escape rejection without requiring file-symlink privileges.

Independent beta regressions drove fixes for stale same-ID workflow reports, secret URL persistence, cancelled recording launches, low-frame-rate timed redaction, and valid Windows short/long path aliases. Run reports require a SHA-256 workflow fingerprint. Old pre-release reports missing it must be replayed; ordinary version-one projects remain readable; older literal secret-URL projects require conversion to runtime URL variables. Presentation edits retain the replay fingerprint; behavior edits require replay.

A built-runtime check found an extensionless module import missed by Bundler resolution. It was fixed, and backend compilation now uses NodeNext resolution so equivalent relative-import mistakes fail the build. The fresh full suite verifies compiled CLI and Electron behavior after the correction.

Independent package review found that Playwright's default browser launch disables Chromium's OS sandbox. Both recording and replay now request `chromiumSandbox: true`; two regression tests first failed against the previous launches, then passed after the fix. Actual Windows recordings and replay also pass with that setting. Electron tests now use their own verified temporary user-data profiles and request sandboxing explicitly. Linux workflow-browser sandbox acceptance remains pending; Electron's renderer setting alone does not prove the separate recording browser is sandboxed.

Browser setup now uses system trust explicitly even when packaged Electron removes inherited Node flags. Closing the editor aborts setup and waits for cleanup of its owned installer process tree. Eight synthetic lifecycle tests cover pre-abort, abort, timeout, success, fixed trusted download options, POSIX escalation, and unverified Windows cleanup failure. A controlled run of the timeout regression against the earlier committed implementation failed before the corrected implementation passed. Failure logs are retained locally; they are not successful acceptance evidence.

Early Windows package acceptance attempts failed: the harness selected three matching checkboxes, an export did not finish, and a later package exposed the same missing-module import. These are not successful install evidence. The corrected harness, browser setup flow and fresh packages still require complete runs. A tested source platform is not automatically a tested distribution package.

Author notes preserve earlier failures. User pilots, production deployments, download counts and star outcomes have not been claimed.
