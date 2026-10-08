# Core and editor review

Reviewed `src/core/project.ts` and the renderer project-editing, runtime-variable, recording, and preview flows. The review added only `tests/review-browser-agent/core-editor-review.test.tsx`; production fixes were made by the editor owner after the review findings were shared.

## Findings and disposition

- **P2 — A runtime-variable edit could leave a stale literal and make the project unsaveable.** The variable selector and literal field are both available for fill/select steps, while the core schema requires exactly one of `value` and `variable`. Selecting a variable now clears the literal, and editing a literal clears the variable. The regression selects a variable, saves through the real core serializer, and checks that the resulting step has only the variable reference.
- **P2 — The editor could create values rejected by the core schema.** A viewport width of `1` previously reached the save bridge, while core requires width 160–4096 and height 120–4096. The renderer now validates before save/replay and keeps the invalid draft visible with an accessible invalid state and a range message. The same validation covers project and step names, locator/value lengths, step count, variable declarations, and step timeouts/pauses.
- **P2 — Browser startup had no cancellation control while its bridge call was pending.** The cancel affordance now includes `startRecording`, signals that startup cancellation was requested, and keeps the operation pending until it settles. The review regression rejects the pending start from the bridge cancellation callback and verifies the UI returns to the ready state.

## Contract and flow checks

`createProject()` supplies version 1, a 1280×720 viewport, empty steps and variables, zero trim start, empty edit layers, and cursor highlighting off. `parseProject()` rejects unknown data, invalid action fields, undeclared variables, duplicate IDs/names, non-HTTP(S) navigation targets, embedded URL credentials, and values outside the documented bounds. Secret variables contain only a name, secret flag, and description; they have no persisted default. `serializeProject()` revalidates and applies the 5 MiB byte limit. `saveProject()` validates before opening a randomized exclusive temporary file, writes and syncs it, then renames it into place; failures close and remove the temporary file. `loadProject()` reads at most one byte beyond the 5 MiB limit before rejecting an oversized file.

The renderer presents secret runtime values as password inputs, passes the values only with the replay request, redacts them from returned errors, and clears secret entries when replay finishes. The review test supplies a synthetic error containing the secret, verifies the displayed error is redacted, then serializes the saved project and confirms the secret value is absent.

The recording UI awaits `stopRecording()` before loading the raw preview. `loadPreview()` requests `getPreview()` and accepts only the local capture URL form. A renderer bridge test verifies the order `start → stop → preview` and that both the trusted video and screenshot are rendered.

## Verification

- `npm test -- --run tests/core/project.test.ts`: 25 passed, including defaults, schema bounds, atomic replacement, preservation on validation/replacement failure, and file-size handling.
- `npm test -- --run tests/review-browser-agent/core-editor-review.test.tsx`: three intended-behavior assertions failed before the editor fixes; after the fixes, all 5 review tests passed.
- `npm test -- --run tests/core/project.test.ts tests/editor/StudioApp.test.tsx tests/review-browser-agent/core-editor-review.test.tsx`: 44 passed.
- `npm run typecheck`: passed.

The editor-flow tests exercise the renderer through a mocked `StudioAPI`; they verify UI state and bridge sequencing, not a launched Electron window or the media service itself.
