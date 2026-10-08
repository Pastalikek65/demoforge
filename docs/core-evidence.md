# Core project evidence

This note records the behavior and verification for the version-one project file core in `src/core/project.ts`.

## Runtime rules

- Project documents must be plain version-one objects. Unknown or non-JSON properties are rejected at every contract object, including undeclared variable fields that could carry runtime secret values.
- Project files and serialized output are capped at 5 MiB. Loading reads at most one byte beyond the cap before rejecting an oversized file.
- A project name is 1–200 characters. General strings are capped at 10,000 characters; selector strings at 2,048; variable names at 64; variable descriptions at 2,000; and audio file references at 4,096.
- Viewports accept widths from 160 through 4,096 and heights from 120 through 4,096. Workflows allow at most 500 steps and 500 variable declarations. Masks and annotations allow 2,000 entries each; zooms allow 500.
- Step and edit IDs are unique across the project. Variable identifiers are unique and use JavaScript-style identifier characters. A step variable reference must match a declaration.
- Navigate steps require an absolute HTTP or HTTPS URL and reject embedded URL credentials. Click steps require a selector. Fill and select steps require a selector and exactly one of a literal value or a declared variable. Wait steps may have a selector and do not accept input values.
- Step timeouts are 1–120,000 ms; pauses are 0–60,000 ms. Edit times are integer milliseconds from 0 through 24 hours, and time ranges must have positive duration. Crop and mask geometry must fit the viewport; zoom coordinates must be within it.
- Audio metadata stores a non-empty file reference, start time, and volume from 0 through 1. The path may be an absolute user-selected filesystem path; the core does not read or inline its contents.
- Saving validates before touching the destination, writes and flushes a uniquely named sibling temporary file, then renames it over the destination. Errors before replacement preserve the prior destination; failed temporary files are removed when possible.

## Verification evidence

The required test-first sequence was observed. The first focused invocation could not resolve the new module and ran zero tests. After exported stubs were added, the focused suite ran and failed against the unimplemented API. The credential-URL and serialized-byte-cap tests were also run with those two guards temporarily removed: both failed as expected (2 failed, 23 skipped); restoring the guards made the complete core suite pass.

Current focused result:

```text
npm test -- tests/core/project.test.ts
Test Files  1 passed (1)
Tests       25 passed (25)
```

The scoped implementation and tests pass an isolated strict TypeScript check:

```text
npx tsc --ignoreConfig --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --types node,vitest/globals --skipLibCheck tests/core/project.test.ts src/core/project.ts src/shared/types.ts
exit code 0
```

The project-wide checks are not green at this snapshot. `npm run typecheck` reports errors in `src/browser/recorder.ts`, `src/renderer/App.tsx`, and `tests/editor/StudioApp.test.tsx`; the isolated check above reports none in the assigned core files. `npm test` reports 29 passed and 11 failed out of 40: six browser runner tests, three media export tests (`spawn ffmpeg ENOENT`), and two editor tests. Those failures are recorded for integration follow-up and are not represented as core acceptance.
