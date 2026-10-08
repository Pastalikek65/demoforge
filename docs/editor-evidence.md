# DemoForge Studio editor evidence

The renderer now presents an English editing studio for recording and maintaining browser workflows. Users can create, open, and save projects; start capture at an HTTP or HTTPS address; cancel startup or capture; stop to bring captured steps into the editor; edit step names, actions, locators, values, timeouts, and pauses; reorder and delete steps; enter runtime values with secret values masked; replay with named step progress; and choose MP4, GIF, Markdown, or HTML output.

The canvas shows the project structure until a run supplies trusted local preview media. After a recording or replay, the editor requests the preview through `StudioAPI.getPreview()` and accepts only `demoforge-media://capture/...` media addresses. Video and screenshots are clearly labeled as raw capture before masks. Black rectangles visualize masks at the selected time; the canvas does not claim to display a rendered, edited video. The export path applies the project edits.

Editing controls cover viewport dimensions, trim points, crop, time-ranged opaque masks, subtitles, zoom moments, cursor highlighting, and a supplied audio file with start time and volume. Local recordings can contain sensitive information; the editor calls this out and requires the user to check the recording and redactions review box before every export. A project edit, recording, or replay clears that review state. Runtime passwords are sent only to replay, cleared when the run settles, and scrubbed from visible run errors.

Project and step names, viewport dimensions, locator/value lengths, and timeout/pause bounds are reflected in the controls and checked before saving or replaying. Invalid drafts remain in their fields with visible validation, instead of being silently clamped. Step action changes remove obsolete optional fields; switching between a literal value and a runtime variable keeps the strict one-of contract without own `undefined` properties.

The renderer uses local system fonts and assets, an English document language, a restrictive content security policy, keyboard-accessible labels and controls, visible focus styling, responsive layouts, and reduced-motion rules.

## Verification

- `npm test -- tests/editor/StudioApp.test.tsx` — 14 editor interaction tests pass, including save after reorder/delete, open/new, secret runtime values, export review, capture and preview loading, cancellation, strict `parseProject` validation, action-field cleanup, and bounds validation.
- `npm test -- tests/editor tests/core tests/browser` — 49 tests pass across the editor, core, and browser suites.
- `npm run typecheck` — passes.
- `npm test` — 58 of 63 tests pass. The five failures are four media export tests and one CLI example that require FFmpeg; the environment reports `spawn ffmpeg ENOENT` or “FFmpeg could not process this media.”

The editor suite stubs only the desktop `StudioAPI` boundary. It renders the real React application and exercises user-visible behavior; the strict project parser is real code imported by the tests.
