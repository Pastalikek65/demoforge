# DemoForge beta/v1 source review

Review updated: 2026-10-08
Reviewed source snapshot: `337e333`, including the conservative title-parser correction, plus the 1.0.0 metadata/CLI delta. The quote-wrapped forbidden-flag finding is closed by controlled regression and independent review. This review uses synthetic data and local services only.

Scope includes masking and export filters, secret URL and form variables, workflow/run binding, compatibility, cancellation, Electron IPC and preview boundaries, browser setup, package CI, and license notices. This review does not establish stable-v1 acceptance.

## Source findings

The reviewed baseline's earlier source findings are closed. A subsequent Linux candidate package replay fails at its first screenshot; the cause remains under investigation and blocks stable release. See the [current failure evidence](verification.md#current-candidate-failure). Four earlier P2 findings are closed:

- **Run/workflow mismatch:** run reports include a SHA-256 fingerprint of replay behavior. Validation checks the fingerprint and ordered step IDs. Presentation-only edits do not invalidate a run; replay changes do.
- **Secret URL persistence:** recognized sensitive query keys, OAuth `code`, and sensitive fragment/query-route keys are detected. Recording stores those URLs as runtime-variable references. Project parsing rejects recognized sensitive literal URLs with a constant, actionable error that does not echo the value. The detector remains heuristic.
- **Browser-start cancellation:** recording and replay attach abort handling before launch, race startup against cancellation, and close a browser that resolves after cancellation.
- **Timed masks at low frame rates:** export normalizes video to 25 fps before applying timed masks; synthetic FFmpeg tests check pixels at the mask boundary.

Additional validated fixes close a project/renderer/IPC mismatch in reserved runtime-variable names (`constructor`, `prototype`, and `__proto__`), enable Chromium's OS sandbox for recording and replay, and clean up owned browser-installer processes on cancellation and timeout. Installer cleanup is bounded and reports when Windows process-tree cleanup cannot be verified. Closing the last editor window waits for the installer, active operation, and browser service cleanup before quitting.

The Chromium title observer receives a joined, unescaped string rather than argument boundaries. Quote-bearing titles are treated as ambiguous, renderer-role classification is suppressed, and raw whitespace-token checks still reject forbidden switches including quote-wrapped switches. This can conservatively false-reject titles; no raw argv is exposed. Observed workflow-browser launches use pinned Chromium without caller-controlled arguments, executable replacement, or channel selection. Chromium constructs the renderer type as its first switch. The controlled regression reproduced the hidden-flag case against the earlier baseline and passed after correction; retained local evidence is `artifacts/linux-title-regression/result.log`.

Electron IPC is restricted to the exact local editor URL in the main frame. The renderer uses sandboxing and context isolation with Node integration disabled; navigation, popups, webviews, permissions, and arbitrary preview paths are denied. Preview requests resolve through the main-process URL-to-file map.

Browser setup accepts no caller-controlled program, URL, or flags. The main process runs the locked Playwright CLI with fixed Chromium-install arguments, uses the per-user runtime directory, logs installer output, and enforces a ten-minute timeout. It enables Node's system certificate store, preserves `NODE_EXTRA_CA_CERTS`, and removes arbitrary `NODE_OPTIONS`, TLS-verification bypasses, and Playwright alternate download-host overrides.

Project schema version 1 has one documented pre-release compatibility exception: a literal navigation URL containing a recognized sensitive query or fragment key must be converted to a declared runtime URL variable before opening. Older pre-release run reports without the required workflow fingerprint must be replayed. Version-1 format fixtures and the first stable installation experience still need verification; no stable 1.0.0 has shipped. Package notices include locked production dependency metadata and found notice texts plus Electron attribution; this inventory does not establish license compliance. The browser download and locally selected FFmpeg have separate terms. Current archives are unsigned.

Mask geometry and timing are edited numerically. The canvas shows the raw capture with mask overlays, not a rendered export, and the review checkbox requires an explicit review before export. This limits preview convenience; review found no separate source-level masking bypass in the export path.

## Current verification and remaining gates

The candidate updates package and lock metadata to 1.0.0 and Node.js 24 LTS without changing dependency versions. Independent review found no defect in the CLI's module-relative package-version lookup. Typecheck/build passed, and actual source and compiled CLI invocations report 1.0.0, including a compiled invocation from another working directory. Local retained `artifacts/cli-version-regression-red.log` and `artifacts/cli-version-regression-green.log` show the earlier hardcoded version mismatch and its correction. This does not qualify a 1.0.0 distribution archive.

- Commit `337e333`, GitHub Actions run [37820720332](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332): Windows job [113460751207](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332/job/113460751207) passed **157/157 tests across 27 files** and fresh extracted-package acceptance for browser setup, recording/replay, masked and captioned MP4/GIF/Markdown/HTML, and output reopening.
- Linux job [113460751037](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332/job/113460751037) passed **156 tests with one Windows-only skip across 27 files** and fresh package acceptance. The harness observed the packaged workflow renderer, Seccomp mode 2 and namespace metadata during record/replay, checked the four export formats and reopened the outputs.
- These results qualify the tested 0.1.0 preview archives only. Independent downloads, hashes and embedded license copies were verified; checksums are recorded in [verification evidence](verification.md). Later 1.0.0 Windows packages passed acceptance, but the Linux screenshot failure remains open; stable acceptance must not be inferred from the preview run.
- Manual audio-editor evidence is from the unpackaged source editor; local retained text evidence is `artifacts/screenshots/audio-timeline-evidence.txt`. Earlier focused regressions passed after the fix; this does not qualify an archive.

The current archives are unsigned. The CLI is documented for source-checkout installation with Node.js 24 LTS. Version-1 format fixtures and the first stable installation experience remain to verify before 1.0.0 release. See [verification evidence](verification.md) and [platform support](support.md) for current qualification boundaries.
