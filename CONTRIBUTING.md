# Contributing

Start with a reproducible problem or a small scoped improvement. Run the synthetic shop example first, then `npm run typecheck`, `npm run build` and `npm test` with local FFmpeg installed. On headless Linux use Xvfb for desktop tests.

Keep changes focused. New behavior should have a failing regression test before the fix, using real input/output where practical. Do not weaken assertions, skip platform checks or log secrets to make a build pass. Document support limitations.

Before opening a pull request, describe the user-visible behavior, how it was tested, and any compatibility/privacy impact. Contributions use Apache-2.0. Please be respectful and do not attach real tokens, personal data or production recordings to issues.
