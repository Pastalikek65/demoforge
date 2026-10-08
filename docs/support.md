# Platform and runtime support

DemoForge has passed preview package acceptance on Windows x64 and Ubuntu 24.04 x64. A stable 1.0.0 release has not been published. The [verification record](verification.md) separates the accepted 0.1.0 preview packages from the pending 1.0.0 candidate run.

| Environment | Source verification | Installed archive |
| --- | --- | --- |
| Windows x64, GitHub Actions | Commit `337e333`, run [37820720332](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332), Windows job [113460751207](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332/job/113460751207): **157/157 tests across 27 files** passed. | The tested 0.1.0 preview archive passed fresh extraction, browser setup, recording/replay, masked and captioned MP4/GIF/Markdown/HTML checks, and output reopening. |
| Ubuntu 24.04 x64, GitHub Actions | Same run, Linux job [113460751037](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332/job/113460751037): **156 passed, one Windows-only test skipped**, across 27 files. | The tested 0.1.0 preview archive passed packaged recording and replay, renderer-role identification, Seccomp mode 2 and namespace observation, masked/captioned checks for all four export formats, and output reopening. |
| Windows x64, local desktop | The current candidate source requires Node.js 24 LTS for source-checkout development and CI. | A 1.0.0 candidate archive has not yet passed fresh CI acceptance. |
| Other operating systems, architectures, and Linux distributions | Not qualified | Not qualified |

The 0.1.0 package results qualify the tested preview archives only. Their SHA-256 values will be recorded after independent archive download and hashing. The 1.0.0 candidate needs fresh Windows and Linux CI against its exact versioned archives before release.

Chromium exposes a joined, unescaped title string rather than original argument boundaries. The parser treats quote-bearing titles as ambiguous, suppresses renderer-role classification for them, and still checks raw whitespace tokens for forbidden switches, including quote-wrapped switches. This conservative behavior may reject titles unnecessarily. Observed workflow-browser launches use pinned Chromium without caller-controlled arguments, executable replacement, or channel selection; the sandbox tests guard forbidden launch options.

The manual audio-editor save/open and start-marker check used the unpackaged source editor. Local retained text evidence is `artifacts/screenshots/audio-timeline-evidence.txt`; it does not qualify an installed archive.

The installed editor includes its Electron runtime. Source-checkout CLI installation is documented and requires Node.js 24 LTS. Packaged users do not need Node.js. The pinned Playwright version controls the browser version. A fresh packaged profile downloads that browser from its official vendor during explicit setup. Internet access is needed for setup; workflows and exports run locally afterward.

Export FFmpeg is installed separately and must support `libx264` and the `subtitles` filter. The Playwright recording helper does not replace that export dependency. Linux needs a display session, browser/Electron shared libraries, and the Electron sandbox helper installed with the ownership and mode described in [Linux sandbox requirements](linux-sandbox.md). See [installation and acceptance](packaging.md) for platform-specific steps.

Before stable 1.0.0, version-1 format fixtures and the first stable installation experience still need verification. Current archives are unsigned. A checksum verifies the downloaded file against the published release asset; it is not a publisher signature. CI package acceptance does not establish independent user pilots or production deployments.
