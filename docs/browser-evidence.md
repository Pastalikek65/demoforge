# Browser engine evidence

The browser runner uses Playwright Chromium for single-tab recording and replay. It writes per-step PNG screenshots and records actual browser video through Playwright's video capture, finalized when the browser context closes. Step, cursor, and duration times start at page creation for the recorded video, so browser startup time is not included in media timing. Replay accepts Playwright selector strings directly, resolves declared runtime variables at execution time, and reports failed and not-run steps with named errors. The recorder coalesces text input events and stores password or heuristically identified sensitive inputs as variable references without a value.

## Checks run

On 2026-10-08, the browser slice was exercised on Windows with Node.js 24.21.0, Playwright 1.64.0, Vitest 5.0.3, and the Playwright-installed headless Chromium.

- `npm run test:browser` — 8 tests passed. The tests use only synthetic pages served from `127.0.0.1`; they exercise navigation, click, fill, select, explicit waits, changed-locator failure, runtime secret resolution, secret-free failure results, cancellation during replay and slow recording startup, and starting a new browser session after cancellation. They read each screenshot as a PNG and check finalized WebM files are non-empty.
- `npm run typecheck` — no diagnostics in `src/browser/**` or `tests/browser/**`; the full command currently reports three errors in root-owned tests: `tests/desktop/smoke.test.ts`, `tests/editor/StudioApp.test.tsx`, and `tests/review/service-cancel-start.test.ts`.

Test output artifacts are created under temporary directories and removed after each test. No user or production site was opened. These checks cover the browser slice on this Windows environment; they do not establish Linux or packaged-app support, nor do they report the status of the full project test suite.

## Privacy and scope limits

Password controls and inputs whose type, autocomplete, name, id, accessible label, or placeholder indicates a password, secret, token, API key, or card security field are recorded as secret variable references. The variable declaration has no default value. Other fill values are part of the recorded project by design. Detection uses page metadata, so an unlabelled sensitive field may not be recognized; review recorded steps before sharing a project or its video.

The engine handles one page at a time and closes popup tabs. It records standard buttons and links, labeled text inputs, selects, main-frame navigation, and same-page history navigation. It does not record arbitrary canvas gestures, keyboard shortcuts, file uploads, or interactions inside cross-origin frames. Video and screenshots are raw local artifacts; export redaction and review are handled elsewhere.
