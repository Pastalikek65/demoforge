# Verification evidence

Updated 2026-10-08. DemoForge's tested 0.1.0 preview packages passed Windows and Ubuntu CI acceptance. The 1.0.0 candidate is not yet accepted or published; this record distinguishes the existing preview evidence from work required for the candidate.

## Accepted 0.1.0 preview package run

Commit `337e333`, GitHub Actions run [37820720332](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332):

| Platform job | Source checks | Extracted-package acceptance |
| --- | --- | --- |
| [Windows x64, job 113460751207](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332/job/113460751207) | **157/157 tests across 27 files** passed. | Fresh package launch and browser setup, actual UI recording and replay, masked/captioned exports in MP4, GIF, Markdown and HTML, and reopening generated outputs passed. |
| [Ubuntu 24.04 x64, job 113460751037](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332/job/113460751037) | **156 passed and one Windows-only test skipped**, across 27 files. | Packaged recording and replay passed. The harness identified the workflow renderer, observed Seccomp mode 2 and namespace metadata, checked masks and captions in all four formats, and reopened the outputs. |

These results qualify the tested 0.1.0 preview archives only. Both artifacts were independently downloaded and hashed; their inner archive checksums match the CI manifests and uploaded draft assets:

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `DemoForge-0.1.0-win-x64.zip` | 161285951 | `71534b8c1d5733fca66771da205130a456f65a0003cc0d7b0f7f5272a468cb63` |
| `DemoForge-0.1.0-linux-x64.tar.gz` | 126943399 | `3923d9eab8278131f1d99706218b551db8fe159079c455844167f2586f9b0a81` |

The preview release remains a draft. Local retained job logs are `.control/windows-ci-337-pass.log` and `.control/linux-ci-337-pass.log`.

## Current 1.0.0 candidate diagnostics

At candidate `77a25d2`, run [37822691803](https://github.com/Pastalikek65/demoforge/actions/runs/37822691803) passed Windows package acceptance but timed out replaying the recorded workflow on Linux. Diagnostic-only commit `34fd77f`, run [37824875571](https://github.com/Pastalikek65/demoforge/actions/runs/37824875571), reproduced the Linux failure: the first step's navigation returned, but its post-step screenshot failed. The step was reported failed and four later steps were not run. Windows again passed package acceptance. The Linux source suite passed 161 tests with one Windows-only skip; Windows passed 162 tests across 28 files.

Commit `29d2e68` added allowlisted operation/cause/viewport diagnostics. Its [CI run 37826381848](https://github.com/Pastalikek65/demoforge/actions/runs/37826381848) passed both extracted-package flows, Windows 172 tests and Linux 171 tests with one Windows-only skip, across 29 files. That diagnostic change did not alter capture timing and does not establish a fix for the intermittent failure.

The next diagnostic, commit `aa0a9d4`, run [37829363612](https://github.com/Pastalikek65/demoforge/actions/runs/37829363612), compared 40 cold headed Chromium launches at 1280×720 in 20 paired rounds. Setup and launch succeeded in both conditions. A first screenshot immediately after `DOMContentLoaded` passed 7 times and failed 13 times with `CAPTURE_REJECTED`; after two animation-frame callbacks, all 20 captures passed with nonempty 1280×720 PNGs. The strict real-runner cold-capture test in the same Linux job still failed at run 7, before completing its 20-run assertion. These results associate the rejection with immediate capture in this fixture; they do not establish the underlying browser/compositor cause or a universal presentation guarantee.

The Linux source suite for `aa0a9d4` failed with that strict capture test: 173 passed, one skipped, and one failed across 31 files. The Windows source suite passed 175 tests, but its fresh-package acceptance did not pass: the first-run progress and locked-controls checks passed, then the harness waited on a setup-notice locator after the success state had removed it. This is a smoke-harness observation race, not evidence that browser installation failed and not a package acceptance pass. The harness now reads alert, notice, and setup-panel state in one DOM snapshot. A scoped independent review found no concrete defect in the capture, cancellation, or atomic-observation changes. Current-source typecheck and build passed, and the full source suite passed 185/185 tests across 33 files (`artifacts/source-acceptance-capture-readiness.log`). Fresh corrected Windows and Linux package CI is still pending.

The current working-tree capture correction waits for two animation-frame callbacks in the ordinary page context, with a maximum 2-second frame wait inside a 5-second total screenshot budget; the screenshot receives only the remaining time. A stalled or replaced animation-frame callback can exhaust the readiness cap; a frozen renderer remains bounded by the caller's capture timeout and close path. It adds no retries and does not guarantee that content has been presented by every browser or operating-system compositor. The source review and source suite passed; fresh corrected Windows and Linux package acceptance remains the release gate.

## Source and behavior evidence

The quote-wrapped forbidden-launch-flag regression reproduced against the earlier `8af92e0` snapshot and passed after the conservative parser correction. The independent source audit closed the bypass finding. Chromium provides an unescaped joined title string, so quote-bearing titles are treated as ambiguous and renderer-role classification is suppressed; raw whitespace-token checks still catch forbidden switches. This may false-reject titles. Observed workflow-browser launches use pinned Chromium without caller-controlled arguments, executable replacement, or channel selection; Chromium constructs the renderer type as its first switch. Raw argv is not exposed. Sandbox tests check forbidden launch options. Local retained regression evidence is `artifacts/linux-title-regression/result.log`.

The manual audio-editor source check confirmed that synthetic audio settings survive save/reopen and the timeline displays the start marker. It used the unpackaged editor; local retained text evidence is `artifacts/screenshots/audio-timeline-evidence.txt`. It does not qualify a package.

Earlier Linux runs failed while reading namespace links or identifying the renderer. The 337e333 package run passed both stages. Namespace IDs remain observations, not proof of namespace separation. Both preview package runs kept the application running as an ordinary user with Chromium sandboxing enabled.

## Remaining 1.0.0 candidate checks

Source tests cover version-1 project/run fixtures, and the compiled source CLI test records a synthetic workflow and parses its project and run through the core validators. Those source-level checks do not qualify a distribution archive. The corrected 1.0.0 candidate still needs fresh Windows and Linux CI acceptance against its exact versioned archives and independent SHA-256 records, including packaged version-1 open/save/replay behavior and the first stable installation experience. The CLI is documented for source-checkout installation with Node.js 24 LTS.

Current archives are unsigned. A checksum identifies file contents but is not a publisher signature. Package CI does not establish independent user pilots or production deployments.
