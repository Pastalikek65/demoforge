# Verification evidence

2026-10-08: Windows x64 MVP candidate. This is not a v1 acceptance record.

- Node 24.21.0; Electron 44.7.0; Playwright 1.64.0; external FFmpeg 7.1 with libx264.
- Fresh `npm run typecheck` and `npm run build`: passed.
- Fresh full `npm test`, with `DEMOFORGE_FFMPEG` set to the local executable: **71/71 tests, 11/11 files, zero unhandled errors**, 11.98 seconds on the development host. Timing is a test-suite observation, not a product benchmark.
- Built CLI runs the five-step shipped shop fixture, writes real video/screenshots, exports all four formats, decodes MP4/GIF, and refuses existing capture directories.
- Actual Electron main/preload/service replay runs the same five-step flow. The sandboxed renderer has no `require`. Trusted raw-video preview decodes at 1280×720. CSP rejects arbitrary renderer fetch; the protocol returns 404 for unregistered media paths.
- Export tests decode both formats, measure black pixels under permanent masks in video and regenerated images, escape guide HTML, preserve existing files, and verify cancellation does not publish a partial directory.
- Independently authored actual-child cancellation harness: passed after fixing its asynchronous rejection handling. Root executed it against the trusted synthetic local fixture. Source reviewers' own execution limits remain recorded in their notes.
- Production dependency audit: zero reported vulnerabilities. Full development dependency audit: eight moderate reports in the electron-builder dependency chain (sprintf-js advisory); no high/critical reported. Packaging/tooling findings remain tracked for beta.

## Open acceptance work

Linux execution and installed-package evidence are pending. Windows archive build/install evidence is pending. Annotation/zoom/cursor/audio effects have isolated tests but are not yet connected to exports. Representative product performance measurements, upgrade/compatibility corpus, final dependency notices, independent v1 closure and releases are pending.

Author notes contain earlier red test runs and environment failures; the fresh full-suite result above supersedes their integration snapshots. Do not infer v1 support or external users from MVP tests.
