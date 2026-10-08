# Development overview

Updated 2026-10-08. DemoForge has a public source repository at [github.com/Pastalikek65/demoforge](https://github.com/Pastalikek65/demoforge), synthetic sample recordings and exports under [`examples/shop/output`](../examples/shop/output/demo.gif), and in-repository engineering review records such as the [beta/v1 source review](release-review.md). The `v0.1.0` preview is a draft; there is no stable v1 release.

The application records and replays single-tab Chromium workflows, edits project steps and privacy effects, and exports local MP4/GIF videos and HTML/Markdown guides. Browser captures remain raw local files and may contain sensitive information; export masks do not alter the originals. See the [architecture](architecture.md), [platform support](support.md), and [verification record](verification.md) for behavior and qualification evidence.

The [verification record](verification.md) tracks completed source and installed-package checks, including known failures and pending release gates. [GitHub Actions](https://github.com/Pastalikek65/demoforge/actions/workflows/ci.yml) runs the Windows/Linux matrix. A passing source suite does not qualify an installed archive; the package harness separately exercises setup, recording, replay and decoded exports.

For local development, install locked dependencies with `npm ci`, run `npm run typecheck`, and run `npm test` (which builds before the tests). Media tests require FFmpeg with `libx264` and the `subtitles` filter; desktop tests require a display, with Xvfb on Linux. See [packaging requirements](packaging.md) before preparing an installed archive.
