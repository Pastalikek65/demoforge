# Browser engine and historical evidence

The browser runner uses Playwright Chromium for single-tab recording and replay. It writes per-step PNG screenshots and records browser video, finalized when the browser context closes. Step, cursor, and duration times start at page creation, so browser startup time is excluded from media timing. Replay accepts Playwright selectors, resolves declared runtime variables at execution time, and reports failed and not-run steps with named errors. The recorder coalesces text-input events and stores password or heuristically identified sensitive inputs as variable references without values.

## Historical focused check: 2026-10-08

On a Windows x64 development machine with Node.js 24.21.0, Playwright 1.64.0, Vitest 5.0.3, and Playwright-installed Chromium, `npm run test:browser` passed **8 tests**. Synthetic pages were served from `127.0.0.1`. The tests covered navigation, click, fill, select, explicit waits, changed-locator failure, runtime-secret resolution, secret-free failure results, cancellation during replay and slow recording startup, and starting a new browser session after cancellation. They decoded the screenshots and checked that finalized WebM files were non-empty.

At that historical snapshot, `npm run typecheck` found no diagnostics in `src/browser/**` or `tests/browser/**`, but reported three errors in integration tests. Those errors were resolved before the later passing typecheck and full-suite runs recorded in the [verification record](verification.md).

These browser-slice checks used synthetic local pages only. They do not by themselves establish installed-package acceptance or Linux support. Consult the [development overview](development.md) and [verification record](verification.md) for current project and release-gate status.

## Privacy and scope limits

Password controls and inputs whose type, autocomplete, name, id, accessible label, or placeholder indicates a password, secret, token, API key, or card security field are recorded as secret variable references. Variable declarations have no default values. Other fill values are part of the recorded project by design. Detection uses page metadata, so an unlabelled sensitive field may not be recognized; review recorded steps before sharing a project or its video.

The engine handles one page at a time and closes popup tabs. It records standard buttons and links, labeled text inputs, selects, main-frame navigation, and same-page history navigation. It does not record arbitrary canvas gestures, keyboard shortcuts, file uploads, or interactions inside cross-origin frames. Video and screenshots are raw local artifacts; export redaction and review are handled elsewhere.
