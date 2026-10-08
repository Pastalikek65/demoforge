# Platform and runtime support

DemoForge is a preview product; there is no stable v1 release. The [verification record](verification.md) distinguishes source checks from installed-archive acceptance.

| Environment | Source verification | Installed archive |
| --- | --- | --- |
| Windows x64, local desktop | Final source typecheck/build and **157/157 tests across 27 files** passed with real FFmpeg, including the conservative title-parser fix. | No archive containing the parser change has been qualified. |
| GitHub `windows-latest`, commit `8af92e0` | CI run [37816359292](https://github.com/Pastalikek65/demoforge/actions/runs/37816359292): **156/156 tests across 27 files** passed. | Fresh extraction and package smoke passed. ZIP SHA-256: `55f14e62dcb98e379d6cc695d1c2f2600aee77bf2d1cebd43b444769c8a37c75`. |
| Ubuntu 24.04 x64 GitHub runner, commit `8af92e0` | Same CI run: **155 passed and one Windows-only test skipped**; typecheck/build and both audits passed. | Archive built, but smoke timed out after 120 seconds waiting to identify a workflow Chromium renderer. App-owned Chrome descendants with Seccomp mode 2 were observed. Linux package acceptance remains open. |
| Other operating systems, architectures, and Linux distributions | Not qualified | Not qualified |

The manual audio-editor save/open and start-marker check used the unpackaged source editor. Local retained text evidence is `artifacts/screenshots/audio-timeline-evidence.txt`; it does not qualify an installed archive. The accepted Windows archive predates the parser correction.

The parser regression now rejects quote-wrapped forbidden switches and conservatively treats quoted Chromium titles as ambiguous, which may false-reject titles. Independent review closed the hidden-flag finding; the fixed launch channels do not accept caller-supplied arguments. A Linux package run for this correction is pending.

The Linux package observer now passes the namespace-link bootstrap that previously failed with `EACCES`, using a fixed CI-only `sudo -n /usr/bin/readlink` command on validated paths. The latest package smoke still failed renderer-role observation. Namespace IDs are observations, not proof of namespace separation, and the observer's synthetic tests do not establish Linux runtime acceptance.

The installed editor includes its Electron runtime. The CLI is documented for source-checkout installation and requires Node.js 22 or newer; verified development and CI use Node.js 24. Before stable v1, version-1 format fixtures and the first stable installation experience still need verification. The pinned Playwright version controls the browser version. A fresh packaged profile downloads that browser from its official vendor during explicit setup. Internet access is needed for setup; workflows and exports run locally afterward.

Export FFmpeg is installed separately and must support `libx264` and the `subtitles` filter. The Playwright recording helper does not replace that export dependency. Linux also needs a display session and the browser/Electron shared libraries; see [installation and acceptance](packaging.md) and [Linux sandbox requirements](linux-sandbox.md).

Current archives are unsigned. A checksum verifies a downloaded file against the published release asset; it is not a publisher signature. No platform result establishes independent user pilots or production deployments. See [verification evidence](verification.md) for the current release-gate status.
