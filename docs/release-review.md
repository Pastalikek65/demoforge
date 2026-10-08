# DemoForge 1.0.0 release review

Reviewed source: `c27561a0401a1971bef26cb40d52723c33d5c1ee`. Review used synthetic data and local services. Independent implementation, test and security review were performed by GPT-6 Luna agents at xhigh effort; the coordinator integrated and independently reran the complete source suite. This is engineering review, not a third-party certification.

## Closed findings

- Run/workflow mismatch: reports bind replay behavior and ordered step IDs to a SHA-256 fingerprint. Presentation-only edits preserve valid runs.
- Recognized sensitive URL persistence: recording stores runtime-variable references; strict parsing rejects recognized sensitive literals without echoing values. Detection remains heuristic.
- Browser and recording-start cancellation: abort handling closes late-starting browsers; a post-initial-capture check prevents returning a recording session after cancellation. The focused regression reproduced the earlier failure and passed after correction.
- Timed masks at low frame rates: video is normalized to 25 fps before masks are applied; synthetic tests check boundary pixels.
- Reserved variable names and Electron boundaries: parser, UI and IPC agree on reserved names. IPC is restricted to the exact local editor main frame; the renderer has sandbox/context isolation and no Node integration. Arbitrary navigation, popups, webviews and preview paths are denied.
- Browser installer lifecycle: fixed vendor installer arguments, bounded cleanup and system TLS trust are used. Arbitrary runtime options, download-host overrides and TLS bypasses are removed.
- Linux title inspection: ambiguous quote-bearing joined titles suppress role classification; raw tokens still reject forbidden switches. This conservative observer can false-reject titles. Pinned workflow Chromium accepts no caller-controlled launch arguments or executable replacement; raw argv is not published.
- Intermittent headed screenshots: a bounded two-frame rendering opportunity replaced immediate capture. The unchanged 20-session real-runner test and actual Windows/Linux package flows passed; readiness or capture failures remain explicit failures. This is tested-scope closure, not a universal compositor guarantee.
- Package setup observation: one atomic DOM snapshot removes the disappearing-notice race while preserving alert, progress, control-lock and completion checks.

## Acceptance and limits

[CI run 37831700885](https://github.com/Pastalikek65/demoforge/actions/runs/37831700885) passed 185/185 source tests on Windows and 184 plus one Windows-only skip on Ubuntu, across 33 files each. Both fresh archives passed all ten setup/recording/replay/export acceptance stages. Independently downloaded archives matched authenticated API digests, inner checksum manifests, versioned code and bundled notices. Exact hashes and scope are in [verification evidence](verification.md).

No open critical/high finding or concrete primary-flow blocker remains for this release's tested scope. Source/media tests cover effects and audio separately from the installed-package primary path. Numeric masking controls show overlays on raw previews; explicit export review and output checks remain necessary. Raw captures can contain sensitive data.

Version-one source fixtures and unknown-version rejection are tested; package open/save/replay round trips passed. Pre-release reports without workflow fingerprints require replay, and recognized sensitive literal URLs require conversion to runtime variables. There is no earlier stable release to qualify for an upgrade.

Dependency/license inventories and notice texts, including Electron and Chromium credits, are bundled. The vendor-downloaded browser and separately installed FFmpeg have their own terms. Archives are unsigned; checksums are not publisher signatures. No independent pilot or production deployment is claimed.
