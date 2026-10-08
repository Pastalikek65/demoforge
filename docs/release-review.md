# DemoForge beta/v1 source review

Review updated: 2026-10-08
Reviewed committed baseline: `8af92e0`, plus the corrected title-parser source. The quote-wrapped forbidden-flag finding is closed by controlled regression and independent review. This review uses synthetic data and local services only.

Scope includes masking and export filters, secret URL and form variables, workflow/run binding, compatibility, cancellation, Electron IPC and preview boundaries, browser setup, package CI, and license notices. This review does not establish stable-v1 acceptance.

## Source findings

No source finding remains open in the reviewed committed baseline. Four earlier P2 findings are closed:

- **Run/workflow mismatch:** run reports include a SHA-256 fingerprint of replay behavior. Validation checks the fingerprint and ordered step IDs. Presentation-only edits do not invalidate a run; replay changes do.
- **Secret URL persistence:** recognized sensitive query keys, OAuth `code`, and sensitive fragment/query-route keys are detected. Recording stores those URLs as runtime-variable references. Project parsing rejects recognized sensitive literal URLs with a constant, actionable error that does not echo the value. The detector remains heuristic.
- **Browser-start cancellation:** recording and replay attach abort handling before launch, race startup against cancellation, and close a browser that resolves after cancellation.
- **Timed masks at low frame rates:** export normalizes video to 25 fps before applying timed masks; synthetic FFmpeg tests check pixels at the mask boundary.

Additional validated fixes close a project/renderer/IPC mismatch in reserved runtime-variable names (`constructor`, `prototype`, and `__proto__`), enable Chromium's OS sandbox for recording and replay, and clean up owned browser-installer processes on cancellation and timeout. Installer cleanup is bounded and reports when Windows process-tree cleanup cannot be verified. Closing the last editor window waits for the installer, active operation, and browser service cleanup before quitting.

Electron IPC is restricted to the exact local editor URL in the main frame. The renderer uses sandboxing and context isolation with Node integration disabled; navigation, popups, webviews, permissions, and arbitrary preview paths are denied. Preview requests resolve through the main-process URL-to-file map.

Browser setup accepts no caller-controlled program, URL, or flags. The main process runs the locked Playwright CLI with fixed Chromium-install arguments, uses the per-user runtime directory, logs installer output, and enforces a ten-minute timeout. It enables Node's system certificate store, preserves `NODE_EXTRA_CA_CERTS`, and removes arbitrary `NODE_OPTIONS`, TLS-verification bypasses, and Playwright alternate download-host overrides.

Project schema version 1 has one documented pre-release compatibility exception: a literal navigation URL containing a recognized sensitive query or fragment key must be converted to a declared runtime URL variable before opening. Older pre-release run reports without the required workflow fingerprint must be replayed. There is no stable v1 format. Package notices include locked production dependency metadata and found notice texts plus Electron attribution; this inventory does not establish license compliance. The browser download and locally selected FFmpeg have separate terms. Current archives are unsigned.

Mask geometry and timing are edited numerically. The canvas shows the raw capture with mask overlays, not a rendered export, and the review checkbox requires an explicit review before export. This limits preview convenience; review found no separate source-level masking bypass in the export path.

## Current verification and remaining gates

- Final local source passed typecheck/build and **157/157 tests across 27 files** with real FFmpeg; retained local log: `artifacts/source-acceptance-linux-parser-final.log`. The controlled title regression record is `artifacts/linux-title-regression/result.log`: the expected forbidden-flag assertion failed against `8af92e0` (exit code 1), and passed against the corrected source (exit code 0). Independent review closed the finding; no raw argv is exposed.
- Windows CI at [`8af92e0`](https://github.com/Pastalikek65/demoforge/actions/runs/37816359292): **156/156 tests across 27 files** and fresh extracted-package smoke passed. ZIP SHA-256: `55f14e62dcb98e379d6cc695d1c2f2600aee77bf2d1cebd43b444769c8a37c75`. This archive predates the local parser change.
- Linux CI at the same run: **155 passed, one Windows-only test skipped**; typecheck, build, audits, and archive generation passed. Package smoke failed after 120 seconds waiting for workflow renderer-role observation. It saw app-owned Chromium processes with Seccomp mode 2, but no workflow renderer match. Linux package acceptance remains open; see the [Actions run](https://github.com/Pastalikek65/demoforge/actions/runs/37816359292).
- The CI-only fixed `sudo -n /usr/bin/readlink` observer passed the namespace-link bootstrap that previously failed with `EACCES`. Namespace IDs are observations, not proof of namespace separation; the observer is not runtime acceptance.
- Manual audio-editor source evidence confirms synthetic audio settings survive save/reopen and that the start marker appears. It used the unpackaged editor; retained local text evidence: `artifacts/screenshots/audio-timeline-evidence.txt`. Earlier focused audio regressions were red against the old source and green after the fix. Independent review of the audio and observer changes found no functional or privilege-boundary defect; this evidence does not qualify an archive.
- Both audits passed in the latest CI run. The package audit reports eight moderate `sprintf-js` findings and no high or critical findings. The caption check is included in the accepted Windows package smoke.

The Linux extracted-package gate remains open; a package run for the corrected parser is pending. Chromium provides an unescaped joined title string, so quote-bearing titles are treated as ambiguous and renderer-role detection is suppressed; raw whitespace checks still detect forbidden switches, including quote-wrapped ones. This can conservatively false-reject titles. App-owned browser launches use fixed executable, path, and channel options with no caller-supplied arguments, and browser-sandbox tests cover forbidden launch options. The CLI is documented for source-checkout installation; version-1 format fixtures and the first stable installation experience still need verification before stable v1. See [verification evidence](verification.md) and [platform support](support.md) for current evidence and limits.
