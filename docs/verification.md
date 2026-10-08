# Verification evidence

DemoForge 1.0.0 is qualified at source commit `c27561a0401a1971bef26cb40d52723c33d5c1ee`. The [release](https://github.com/Pastalikek65/demoforge/releases/tag/v1.0.0) contains the exact accepted archives, `SHA256SUMS.txt`, two package-acceptance logs and a scoped release attestation. The archives are unsigned.

## Accepted distribution

[GitHub Actions run 37831700885](https://github.com/Pastalikek65/demoforge/actions/runs/37831700885) completed successfully on 2026-10-08:

| Platform | Source checks | Fresh archive checks |
| --- | --- | --- |
| [Windows x64, job 113498409559](https://github.com/Pastalikek65/demoforge/actions/runs/37831700885/job/113498409559) | 185/185 tests across 33 files. | All ten acceptance stages passed. |
| [Ubuntu 24.04 x64, job 113498409985](https://github.com/Pastalikek65/demoforge/actions/runs/37831700885/job/113498409985) | 184 passed, one Windows-only skip, across 33 files. | All ten acceptance stages passed; enabled Electron/Chromium sandboxing and Seccomp mode 2 observed. |

Fresh package checks launch the packaged app with an isolated profile, install the vendor browser through the UI, record and replay a synthetic five-step workflow, save and reopen version-one projects, and export MP4, GIF, Markdown and HTML. FFmpeg decodes outputs and checks opaque-mask/caption pixels. Secret canaries are excluded from saved/exported data and raw captures are absent from published outputs. The harness reopens HTML, PNG and GIF outputs in Chromium. Namespace IDs are observations, not proof of namespace separation.

## Independent archive verification

Both GitHub artifacts were independently downloaded. Their API sizes and SHA-256 values, CRCs, paths and file types were checked before extracting their outer evidence ZIPs. The inner packages were inspected without extraction or execution. Their checksums match CI manifests; packaged app.asar is version 1.0.0 and contains the compiled readiness correction. Executables, Electron/Chromium credits and matching embedded dependency notices are present.

| Distribution archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `DemoForge-1.0.0-win-x64.zip` | 161288480 | `e50f94665d1a361a70e2b98af8e88b444d29223090bbae96a268722f0550a2ee` |
| `DemoForge-1.0.0-linux-x64.tar.gz` | 126945729 | `71850f2f6e5da4b7d05d22665c0aa5068887707da9a2a7ac210651e1b516f3c7` |

The Windows outer artifact 11573443180 was 163145899 bytes with SHA-256 `4de019fc9b964fbb742c1061b39ae994d1eaaede56a59cf6b17ca55efbd5b263`. Linux artifact 11573473418 was 128600671 bytes with SHA-256 `6bad79b088781d9f40710ca8e44022ee0580d9a32976d14e7a8edd74063cc067`. These outer hashes identify CI evidence containers; download users should verify the distribution hashes above.

## Regression and scope

Earlier Linux candidates failed the first post-navigation screenshot. At `aa0a9d4`, a 40-launch comparison had 7/20 immediate captures pass versus 20/20 after two animation-frame callbacks, while the strict real-runner test still failed. The correction at `c27561a` waits for two callbacks within the existing five-second screenshot budget, with a two-second readiness bound. The unchanged real-runner test then passed 20 fresh headed sessions on each platform and both package flows passed. This closes the tested reliability finding. A separate diagnostic at `c27561a` observed 9/20 immediate captures pass and 19 post-frame captures succeed, with one readiness timeout and capture not run. The rendering opportunity is empirical, not a universal compositor or website guarantee; timeouts remain controlled failures.

Recording-start cancellation reproduced before correction and passed afterward. The package harness now takes one atomic DOM snapshot during setup transitions; error, progress, control-lock and success criteria remain unchanged. Independent review found no concrete blocker in these changes.

Source tests separately cover version-one fixtures and unknown-version rejection, strict project/run boundaries, changed targets, secret exclusion, cancellation and audio/media effects. The compiled CLI is tested for record, replay, export and doctor. Manual audio-editor save/reopen evidence came from the unpackaged editor and is not separate package proof. A representative local 25-step/four-format measurement is in [performance](performance.md), with memory and platform limits disclosed.

## Historical preview

The public source MVP and beta preceded stable qualification. At `337e333`, [run 37820720332](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332) accepted the 0.1.0 preview archives; those draft-release assets are not the stable distribution. Windows preview SHA-256: `71534b8c1d5733fca66771da205130a456f65a0003cc0d7b0f7f5272a468cb63`; Linux preview: `3923d9eab8278131f1d99706218b551db8fe159079c455844167f2586f9b0a81`.

No earlier stable upgrade, every effect combination in installed packages, independent user pilot, download count, star count or production deployment is claimed. Supported scope is Windows x64 and Ubuntu 24.04 x64. SHA-256 identifies contents; it is not a publisher signature.
