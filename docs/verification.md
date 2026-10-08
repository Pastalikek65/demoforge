# Verification evidence

Updated 2026-10-08. DemoForge's tested 0.1.0 preview packages passed Windows and Ubuntu CI acceptance. The 1.0.0 candidate is not yet accepted or published; this record distinguishes the existing preview evidence from work required for the candidate.

## Accepted 0.1.0 preview package run

Commit `337e333`, GitHub Actions run [37820720332](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332):

| Platform job | Source checks | Extracted-package acceptance |
| --- | --- | --- |
| [Windows x64, job 113460751207](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332/job/113460751207) | **157/157 tests across 27 files** passed. | Fresh package launch and browser setup, actual UI recording and replay, masked/captioned exports in MP4, GIF, Markdown and HTML, and reopening generated outputs passed. |
| [Ubuntu 24.04 x64, job 113460751037](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332/job/113460751037) | **156 passed and one Windows-only test skipped**, across 27 files. | Packaged recording and replay passed. The harness identified the workflow renderer, observed Seccomp mode 2 and namespace metadata, checked masks and captions in all four formats, and reopened the outputs. |

These results qualify the tested 0.1.0 preview archives only. Their SHA-256 values are omitted until the archives are independently downloaded and hashed. Local retained job logs are `.control/windows-ci-337-pass.log` and `.control/linux-ci-337-pass.log`.

## Source and behavior evidence

The quote-wrapped forbidden-launch-flag regression reproduced against the earlier `8af92e0` snapshot and passed after the conservative parser correction. The independent source audit closed the bypass finding. Chromium provides an unescaped joined title string, so quote-bearing titles are treated as ambiguous and renderer-role classification is suppressed; raw whitespace-token checks still catch forbidden switches. This may false-reject titles. Observed workflow-browser launches use pinned Chromium without caller-controlled arguments, executable replacement, or channel selection; Chromium constructs the renderer type as its first switch. Raw argv is not exposed. Sandbox tests check forbidden launch options. Local retained regression evidence is `artifacts/linux-title-regression/result.log`.

The manual audio-editor source check confirmed that synthetic audio settings survive save/reopen and the timeline displays the start marker. It used the unpackaged editor; local retained text evidence is `artifacts/screenshots/audio-timeline-evidence.txt`. It does not qualify a package.

Earlier Linux runs failed while reading namespace links or identifying the renderer. The 337e333 package run passed both stages. Namespace IDs remain observations, not proof of namespace separation. Both preview package runs kept the application running as an ordinary user with Chromium sandboxing enabled.

## Remaining 1.0.0 candidate checks

The current 1.0.0 candidate must pass fresh Windows and Linux CI acceptance using its exact versioned archives. Independently download and record each archive's SHA-256 before publishing. Verify version-1 format fixtures and the first stable installation experience before the stable release. The CLI is documented for source-checkout installation with Node.js 24 LTS.

Current archives are unsigned. A checksum identifies file contents but is not a publisher signature. Package CI does not establish independent user pilots or production deployments.
