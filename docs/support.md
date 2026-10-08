# Platform and runtime support

DemoForge 1.0.0 is qualified for the following environments at source commit `c27561a0401a1971bef26cb40d52723c33d5c1ee`. [CI run 37831700885](https://github.com/Pastalikek65/demoforge/actions/runs/37831700885) tested fresh versioned archives, not just source builds. See the [verification record](verification.md) and release attestation for exact archive hashes.

| Environment | Source checks | Fresh archive acceptance |
| --- | --- | --- |
| Windows x64, GitHub Actions | 185/185 tests across 33 files. | Browser setup, UI recording/save/reopen/replay, masked and captioned MP4/GIF/Markdown/HTML, secret checks and output reopening passed. |
| Ubuntu 24.04 x64, GitHub Actions | 184 passed and one Windows-only skip across 33 files. | The same primary flow passed, including observation of enabled Electron/Chromium sandboxing and Seccomp mode 2 during recording/replay. |
| Windows x64, local development machine | Typecheck/build and 185/185 source tests; synthetic 25-step/four-format benchmark passed. | The release archive was qualified on Windows CI; a separate installed-archive acceptance on this desktop is not claimed. |
| Other operating systems, architectures and Linux distributions | Not qualified. | Not qualified. |

The unchanged cold-capture test passed 20 fresh headed-browser sessions on each CI platform. Capture waits for two animation-frame callbacks for at most two seconds within a five-second total screenshot budget. This is an empirically tested rendering opportunity, not a universal compositor guarantee. Pages that suspend or replace the animation-frame API can time out; replay reports the failed step and leaves later steps not-run.

The installed editor includes Electron. Packaged users do not need Node.js; source-checkout development and the CLI require Node.js 24 LTS. Explicit first-run setup downloads the pinned Playwright Chromium runtime from its vendor into the per-user application data directory. Internet access is required for that setup; subsequent workflows and exports run locally.

Export requires a separately installed FFmpeg supporting `libx264` and the `subtitles` filter. The browser's recording helper does not replace that dependency. Linux needs a display session, browser/Electron shared libraries, and the root-owned Electron sandbox helper described in [Linux sandbox requirements](linux-sandbox.md). See [installation and acceptance](packaging.md) for platform-specific steps.

Source tests separately cover audio, trim/crop, zoom, cursor emphasis and timed annotations. The package flow exercises the primary recording/replay/masking/caption/export path, not every effect combination. Manual audio-editor evidence came from the unpackaged editor and is not separate package proof.

Version-one project/run fixtures, unsupported-version rejection and strict boundary behavior are covered by source tests; package acceptance verifies real version-one open/save/replay round trips. There is no earlier stable version to qualify for an upgrade. Documented pre-release compatibility exceptions require replaying old fingerprint-free reports and converting recognized sensitive literal URLs to runtime variables.

The archives are unsigned. SHA-256 identifies file contents; it is not a publisher signature. CI acceptance does not establish independent user pilots or production deployments. Linux namespace IDs are observations, not proof of namespace separation.
