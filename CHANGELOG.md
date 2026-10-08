# Changelog

## 1.0.0 — 2026-10-08

- CLI version output now follows package metadata instead of a hardcoded preview version.
- Aligned source-checkout development and CLI guidance on Node.js 24 LTS; added package installation and Linux sandbox guidance for the candidate.
- Screenshots wait for two animation-frame callbacks within the existing five-second capture budget; a readiness timeout or actual capture failure still fails replay with a sanitized diagnostic.
- Recording startup rejects cancellation during its initial capture instead of returning a stopped session.
- Package acceptance reads setup alerts in one DOM snapshot, preserving its progress, control-lock and completion checks across the setup-panel transition.
- Version-one project/run acceptance and unknown-version rejection are covered by source tests. The exact 1.0.0 Windows/Linux archives passed fresh package acceptance and independent checksum verification; see the [verification record](docs/verification.md).

## 0.1.0 — MVP candidate

- Local Electron workflow editor and separate Chromium recording/replay process.
- Navigation, click, text input, select and wait steps; strict version-one project files.
- Real browser video, screenshots, MP4/GIF and offline Markdown/HTML guides.
- Permanent temporal masks, trim/crop, annotations/subtitles, zoom, cursor emphasis, and supplied audio.
- Audio settings restored when opening projects, with an accessible timeline start marker.
- Runtime secret references, replay fingerprints, cancellation and controlled step failures.
- Explicit vendor browser setup with system TLS trust and owned installer cleanup; sandboxed workflow Chromium.
- Synthetic shop example, English documentation and Turkish quickstart.

Public source preview with the listed beta features integrated. CI run [37820720332](https://github.com/Pastalikek65/demoforge/actions/runs/37820720332) passed packaged acceptance for Windows x64 and Ubuntu 24.04 x64, including real browser setup, UI recording/replay, masked and captioned MP4/GIF/Markdown/HTML checks, and reopening outputs. Independently verified preview archive hashes are in the [verification record](docs/verification.md); the preview release remains a draft. Stable 1.0.0 is qualified separately at `c27561a`; unsupported platforms and external user pilots are not claimed.
