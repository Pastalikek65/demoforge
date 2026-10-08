# Platform and runtime support

DemoForge is a preview product. There is no stable v1 release yet. This table separates tested source behavior from installed-archive acceptance.

| Environment | Source verification | Installed archive |
| --- | --- | --- |
| Windows x64, local desktop kernel 10.0.26300 | Current local source typecheck/build passed; 149/149 tests across 25 files passed, alongside actual Electron, CLI, Chromium and FFmpeg tests | Preview ZIP `4F8D3D1C88E9AF2A9D63000AE7305DE1B0A04444A3B8437FB80A7FC7236DA5DC` passed current-harness package smoke, including first-run setup, UI recording/replay, caption-pixel check and exports; ZIP predates the harness-only assertion correction |
| GitHub `windows-latest`, commit `ba71d08` | CI run 37810979656: typecheck/build passed; 148/148 tests across 24 files passed | Fresh archive acceptance passed for setup, UI recording/replay, masked exports, and reopening; this archive predates the corrected caption-pixel check |
| Ubuntu 24.04 x64 GitHub runner | CI run 37810979656 timed out in apt media/display prerequisites before tests; prior source run at `d995eb3` had 143 passed and one Windows-only test skipped | No archive acceptance in the latest run; Linux remains unqualified |
| Other operating systems, architectures and Linux distributions | Not qualified | Not qualified |

The installed editor includes its Electron runtime. The source CLI requires Node.js 22 or newer; the verified development and CI runtime is Node.js 24. The pinned Playwright version controls the browser version. A fresh packaged profile downloads that browser directly from its official vendor during explicit setup. Internet access is needed for setup, while workflows and exports run locally afterward.

Export FFmpeg is installed separately and must support `libx264` and the `subtitles` filter. The Playwright recording helper does not replace that export dependency. Linux also needs a display session and the browser/Electron shared libraries; see [installation and acceptance](packaging.md) and [Linux sandbox requirements](linux-sandbox.md).

The Linux package smoke harness reads renderer Seccomp mode and namespace IDs. The namespace IDs are recorded observations; acceptance does not assert that they differ from the app or host namespaces. The current caption-pixel crop correction passed both its focused synthetic regression and a local current-harness package run; Windows CI acceptance with the corrected harness and Linux archive acceptance remain pending.

Current archives are unsigned. A checksum verifies the downloaded file against the published release asset; it is not a publisher signature. No platform result establishes independent user pilots or production deployments.
