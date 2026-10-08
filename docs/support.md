# Platform and runtime support

DemoForge is a preview product. There is no stable v1 release yet. This table separates tested source behavior from installed-archive acceptance.

| Environment | Source verification | Installed archive |
| --- | --- | --- |
| Windows x64, local desktop kernel 10.0.26300 | Actual Electron, CLI, Chromium and FFmpeg tests passed | Preview archive `4f8d3d1c…` passed first-run setup, UI recording, project round-trip, replay and all four exports |
| GitHub `windows-latest` x64 | 144 tests passed at `d995eb3` | Recording/replay passed; save-check synchronization in the acceptance harness needs a rerun |
| Ubuntu 24.04 x64 GitHub runner | 143 tests passed at `d995eb3`; one Windows-specific path test skipped | Setup passed; workflow renderer sandbox observation needs a rerun |
| Other operating systems, architectures and Linux distributions | Not qualified | Not qualified |

The installed editor includes its Electron runtime. The source CLI requires Node.js 22 or newer; the verified development and CI runtime is Node.js 24. The pinned Playwright version controls the browser version. A fresh packaged profile downloads that browser directly from its official vendor during explicit setup. Internet access is needed for setup, while workflows and exports run locally afterward.

Export FFmpeg is installed separately and must support `libx264` and the `subtitles` filter. The Playwright recording helper does not replace that export dependency. Linux also needs a display session and the browser/Electron shared libraries; see [installation and acceptance](packaging.md) and [Linux sandbox requirements](linux-sandbox.md).

Current archives are unsigned. A checksum verifies the downloaded file against the published release asset; it is not a publisher signature. No platform result establishes independent user pilots or production deployments.
