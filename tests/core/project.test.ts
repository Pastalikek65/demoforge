import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '../../src/shared/types';
import { createProject, loadProject, parseProject, saveProject, serializeProject } from '../../src/core/project';

const projectFixture = (): Project => ({
  schemaVersion: 1,
  name: 'Intro demo',
  viewport: { width: 1280, height: 720 },
  steps: [
    { id: 'step-1', name: 'Open the page', action: 'navigate', target: 'https://example.com/start', timeoutMs: 15000, pauseMs: 250 },
    { id: 'step-2', name: 'Search', action: 'fill', target: '#search', variable: 'query', timeoutMs: 5000, pauseMs: 0 },
  ],
  variables: [{ name: 'query', secret: false, description: 'Search text' }],
  edits: {
    trimStartMs: 0,
    masks: [{ id: 'mask-1', x: 10, y: 20, width: 100, height: 40, startMs: 0, endMs: 2500 }],
    annotations: [{ id: 'annotation-1', text: 'Search here', startMs: 500, endMs: 1500 }],
    zooms: [{ startMs: 500, endMs: 1500, scale: 1.5, x: 640, y: 360 }],
    cursorHighlight: true,
  },
});

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'demoforge-core-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('createProject', () => {
  it('creates a named, empty version-one project with usable editing defaults', () => {
    expect(createProject('Welcome demo')).toEqual({
      schemaVersion: 1,
      name: 'Welcome demo',
      viewport: { width: 1280, height: 720 },
      steps: [],
      variables: [],
      edits: {
        trimStartMs: 0,
        masks: [],
        annotations: [],
        zooms: [],
        cursorHighlight: false,
      },
    });
  });
});

describe('parseProject', () => {
  it('accepts a complete version-one project without changing its declared data', () => {
    const fixture = projectFixture();

    expect(parseProject(fixture)).toEqual(fixture);
  });

  it('rejects unsupported schema versions with a version-specific error', () => {
    expect(() => parseProject({ ...projectFixture(), schemaVersion: 2 })).toThrow(/schemaVersion.*1/i);
  });

  it('rejects unrecognized properties that could carry undeclared secret values', () => {
    const fixture = projectFixture();
    const withSecretPayload = {
      ...fixture,
      variables: [{ ...fixture.variables[0], value: 'runtime-password' }],
    };

    expect(() => parseProject(withSecretPayload)).toThrow(/variables\[0\].*value/i);
  });

  it('requires navigate targets to use HTTP or HTTPS', () => {
    const fixture = projectFixture();
    fixture.steps[0] = { ...fixture.steps[0], target: 'javascript:alert(1)' };

    expect(() => parseProject(fixture)).toThrow(/steps\[0\].*http/i);
  });

  it('rejects embedded credentials in navigate URLs instead of storing them in the project', () => {
    const fixture = projectFixture();
    fixture.steps[0] = { ...fixture.steps[0], target: 'https://demo:secret@example.com/' };

    expect(() => parseProject(fixture)).toThrow(/steps\[0\].*embedded credentials/i);
  });

  it('rejects sensitive literal navigation query parameters without echoing their values', () => {
    const fixture = projectFixture();
    const secret = 'SYNTHETIC_ACCESS_TOKEN_6c4a';
    fixture.steps[0] = {
      ...fixture.steps[0],
      target: `https://example.test/callback?access_token=${secret}&state=fixture`,
    };

    let error: unknown;
    try { parseProject(fixture); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/sensitive.*runtime variable/i);
    expect((error as Error).message).not.toContain(secret);
  });

  it('allows a declared runtime variable to provide a navigation URL', () => {
    const fixture = projectFixture();
    const { target: _target, ...step } = fixture.steps[0];
    fixture.steps[0] = { ...step, variable: 'startUrl' };
    fixture.variables.push({ name: 'startUrl', secret: false, description: 'Starting page URL' });

    expect(parseProject(fixture).steps[0]).toMatchObject({ action: 'navigate', variable: 'startUrl' });
    expect(parseProject(fixture).steps[0]).not.toHaveProperty('target');
  });

  it('rejects an undeclared navigation URL variable', () => {
    const fixture = projectFixture();
    const { target: _target, ...step } = fixture.steps[0];
    fixture.steps[0] = { ...step, variable: 'missingUrl' };

    expect(() => parseProject(fixture)).toThrow(/steps\[0\].*variable.*missingUrl/i);
  });

  it('requires navigation to provide exactly one literal target or runtime variable', () => {
    const fixture = projectFixture();
    fixture.steps[0] = { ...fixture.steps[0], variable: 'startUrl' };
    fixture.variables.push({ name: 'startUrl', secret: false, description: 'Starting page URL' });

    expect(() => parseProject(fixture)).toThrow(/steps\[0\].*exactly one/i);
  });

  it('requires a locator for click actions', () => {
    const fixture = projectFixture();
    fixture.steps[0] = { id: 'step-1', name: 'Click', action: 'click', timeoutMs: 1000, pauseMs: 0 };

    expect(() => parseProject(fixture)).toThrow(/steps\[0\].*target/i);
  });

  it('requires fill and select actions to have exactly one literal value or declared variable', () => {
    const fixture = projectFixture();
    fixture.steps[1] = {
      id: 'step-2', name: 'Search', action: 'fill', target: '#search', value: 'literal', variable: 'query', timeoutMs: 5000, pauseMs: 0,
    };

    expect(() => parseProject(fixture)).toThrow(/steps\[1\].*(value|variable)/i);
  });

  it('rejects references to variables that are not declared', () => {
    const fixture = projectFixture();
    fixture.steps[1] = { ...fixture.steps[1], variable: 'missing' };

    expect(() => parseProject(fixture)).toThrow(/steps\[1\].*variable.*missing/i);
  });

  it('rejects duplicate step identifiers', () => {
    const fixture = projectFixture();
    fixture.steps[1] = { ...fixture.steps[1], id: 'step-1' };

    expect(() => parseProject(fixture)).toThrow(/duplicate.*id/i);
  });

  it('rejects duplicate variable names so references resolve unambiguously', () => {
    const fixture = projectFixture();
    fixture.variables.push({ name: 'query', secret: true, description: 'Second declaration' });

    expect(() => parseProject(fixture)).toThrow(/duplicate.*variable/i);
  });

  it('caps the number of steps before accepting an oversized workflow', () => {
    const fixture = projectFixture();
    fixture.steps = Array.from({ length: 501 }, (_, index) => ({
      id: `step-${index}`,
      name: `Wait ${index}`,
      action: 'wait' as const,
      timeoutMs: 1000,
      pauseMs: 0,
    }));

    expect(() => parseProject(fixture)).toThrow(/steps.*500/i);
  });

  it('limits locator length so a project cannot carry an unbounded selector', () => {
    const fixture = projectFixture();
    fixture.steps[1] = { ...fixture.steps[1], target: `#${'x'.repeat(2048)}` };

    expect(() => parseProject(fixture)).toThrow(/steps\[1\].*target.*2048/i);
  });

  it('requires edit geometry to remain inside the declared viewport', () => {
    const fixture = projectFixture();
    fixture.edits.crop = { x: 1200, y: 0, width: 100, height: 100 };

    expect(() => parseProject(fixture)).toThrow(/edits\.crop.*viewport/i);
  });

  it('requires edit time ranges to have a positive duration within the supported bound', () => {
    const fixture = projectFixture();
    fixture.edits.annotations[0] = { ...fixture.edits.annotations[0], endMs: fixture.edits.annotations[0].startMs };

    expect(() => parseProject(fixture)).toThrow(/edits\.annotations\[0\].*endMs/i);
  });

  it('rejects an unbounded project name with the field named in the error', () => {
    expect(() => parseProject({ ...projectFixture(), name: 'x'.repeat(201) })).toThrow(/name.*200/i);
  });
});

describe('serializeProject', () => {
  it('writes only the validated declaration data and can be parsed back', () => {
    const fixture = projectFixture();
    const json = serializeProject(fixture);

    expect(JSON.parse(json)).toEqual(fixture);
    expect(parseProject(JSON.parse(json))).toEqual(fixture);
  });

  it('refuses to serialize undeclared properties instead of silently persisting them', () => {
    const fixture = projectFixture();
    const withSecretPayload = {
      ...fixture,
      variables: [{ ...fixture.variables[0], value: 'runtime-password' }],
    };

    expect(() => serializeProject(withSecretPayload as Project)).toThrow(/variables\[0\].*value/i);
  });

  it('caps serialized bytes even when every individual field is within its string limit', () => {
    const fixture = projectFixture();
    fixture.edits.annotations = Array.from({ length: 530 }, (_, index) => ({
      id: `annotation-${index}`,
      text: 'x'.repeat(10_000),
      startMs: 0,
      endMs: 1,
    }));

    expect(() => serializeProject(fixture)).toThrow(/5 MiB/i);
  });
});

describe('project files', () => {
  it('saves and loads a project through the real filesystem', async () => {
    const file = join(directory, 'intro.demoforge.json');
    const fixture = projectFixture();

    await saveProject(file, fixture);

    expect(await loadProject(file)).toEqual(fixture);
  });

  it('atomically replaces a prior project file on the current platform', async () => {
    const file = join(directory, 'replace.demoforge.json');
    const previous = projectFixture();
    previous.name = 'Prior project';
    await writeFile(file, JSON.stringify(previous), 'utf8');
    const replacement = projectFixture();
    replacement.name = 'Replacement project';

    await saveProject(file, replacement);

    expect(await loadProject(file)).toEqual(replacement);
  });

  it('preserves an existing file when the replacement project is invalid', async () => {
    const file = join(directory, 'existing.demoforge.json');
    const original = '{"keep":"previous contents"}';
    await writeFile(file, original, 'utf8');
    const invalid = projectFixture();
    invalid.steps[0] = { id: 'step-1', name: 'Click', action: 'click', timeoutMs: 1000, pauseMs: 0 };

    await expect(saveProject(file, invalid)).rejects.toThrow(/steps\[0\].*target/i);

    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('preserves an existing directory and its files if the final atomic replacement fails', async () => {
    const destination = join(directory, 'destination');
    await mkdir(destination);
    const marker = join(destination, 'keep.txt');
    await writeFile(marker, 'previous contents', 'utf8');

    let replaceError: unknown;
    try {
      await saveProject(destination, projectFixture());
    } catch (error) {
      replaceError = error;
    }

    expect(replaceError).toBeInstanceOf(Error);
    expect((replaceError as Error).message).toMatch(/EISDIR|EPERM|EEXIST|directory|rename/i);

    expect(await readFile(marker, 'utf8')).toBe('previous contents');
  });

  it('rejects a project file whose bytes exceed the supported size before parsing', async () => {
    const file = join(directory, 'too-large.demoforge.json');
    await writeFile(file, Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));

    await expect(loadProject(file)).rejects.toThrow(/5 MiB/i);
  });

  it('reports malformed project files with the file path and parse failure', async () => {
    const file = join(directory, 'broken.demoforge.json');
    await writeFile(file, '{"schemaVersion":', 'utf8');

    await expect(loadProject(file)).rejects.toThrow(/broken\.demoforge\.json.*JSON/i);
  });
});
