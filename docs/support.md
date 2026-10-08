# Platform and runtime support

DemoForge is a preview product. There is no stable v1 release yet. This table separates tested source behavior from installed-archive acceptance.

| Environment | Source verification | Installed archive |
| --- | --- | --- |
| Windows x64, local desktop kernel 10.0.26300 | Current local typecheck/build and 156/156 tests across 27 files passed with real FFmpeg | Preview ZIP `4F8D3D1C88E9AF2A9D63000AE7305DE1B0A04444A3B8437FB80A7FC7236DA5DC` passed the corrected-caption package smoke; ZIP predates the current audio-editor changes, which remain unqualified in an installed package |
| GitHub `windows-latest`, commit `c72bfc5` | CI run 37813669415: typecheck/build passed; 149/149 tests across 25 files passed | Fresh archive acceptance passed with corrected caption and mask checks; ZIP SHA-256 `28aa6afdc28e254bc8f8ab54c0d44b1bed08f48c1fc478272199e177a0bc2a49`; predates current local audio changes |
| Ubuntu 24.04 x64 GitHub runner, commit `c72bfc5` | CI run 37813669415: typecheck/build passed; 148 passed and one Windows-only test skipped; both audits passed | Archive built, but package smoke failed reading the Electron renderer user namespace (`EACCES`); the CI-only observer change awaits a Linux rerun. Linux remains unqualified |
| Other operating systems, architectures and Linux distributions | Not qualified | Not qualified |

The installed editor includes its Electron runtime. The source CLI requires Node.js 22 or newer; the verified development and CI runtime is Node.js 24. The pinned Playwright version controls the browser version. A fresh packaged profile downloads that browser directly from its official vendor during explicit setup. Internet access is needed for setup, while workflows and exports run locally afterward.

Export FFmpeg is installed separately and must support `libx264` and the `subtitles` filter. The Playwright recording helper does not replace that export dependency. Linux also needs a display session and the browser/Electron shared libraries; see [installation and acceptance](packaging.md) and [Linux sandbox requirements](linux-sandbox.md).

The Linux package smoke harness reads renderer Seccomp mode and namespace IDs. The namespace IDs are observations, not proof of namespace separation. After CI encountered `EACCES` reading a renderer namespace link, a CI-only observer was added that uses a fixed `sudo -n /usr/bin/readlink` command on validated namespace paths while keeping the app running as an ordinary user with sandboxing. Its five synthetic tests and independent source review passed, but Linux runtime acceptance has not been rerun. Source review does not qualify a platform package.

Current archives are unsigned. A checksum verifies the downloaded file against the published release asset; it is not a publisher signature. No platform result establishes independent user pilots or production deployments.
