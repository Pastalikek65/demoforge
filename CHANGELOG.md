# Changelog

## 1.0.0 — release candidate, not yet published

- CLI version output now follows package metadata instead of a hardcoded preview version.
- Aligned source-checkout development and CLI guidance on Node.js 24 LTS; added package installation and Linux sandbox guidance for the candidate.
- 0.1.0 preview archives passed packaged Windows and Ubuntu CI acceptance. The 1.0.0 candidate still requires fresh CI against its exact versioned archives, independent archive checksums, version-1 format fixture checks, and first stable-install verification.

## 0.1.0 — MVP candidate

- Local Electron workflow editor and separate Chromium recording/replay process.
- Navigation, click, text input, select and wait steps; strict version-one project files.
- Real browser video, screenshots, MP4/GIF and offline Markdown/HTML guides.
- Permanent temporal masks, trim/crop, annotations/subtitles, zoom, cursor emphasis, and supplied audio.
- Audio settings restored when opening projects, with an accessible timeline start marker.
- Runtime secret references, replay fingerprints, cancellation and controlled step failures.
- Explicit vendor browser setup with system TLS trust and owned installer cleanup; sandboxed workflow Chromium.
- Synthetic shop example, English documentation and Turkish quickstart.

Public source preview with the listed beta features integrated. CI run [37820720332](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332) passed packaged acceptance for Windows x64 and Ubuntu 24.04 x64, including real browser setup, UI recording/replay, masked and captioned MP4/GIF/Markdown/HTML checks, and reopening outputs. Preview archive hashes await independent download and verification. Stable 1.0.0 acceptance remains pending; unsupported platforms and external user pilots have not been claimed.
