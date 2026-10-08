import { open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { Action, Project } from '../shared/types';

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const MAX_STEPS = 500;
const MAX_VARIABLES = 500;
const MAX_MASKS = 2_000;
const MAX_ANNOTATIONS = 2_000;
const MAX_ZOOMS = 500;
const MAX_STRING_LENGTH = 10_000;
const MAX_LOCATOR_LENGTH = 2_048;
const MAX_PROJECT_NAME_LENGTH = 200;
const MAX_EDIT_TIME_MS = 24 * 60 * 60 * 1_000;

type DataRecord = Record<string, unknown>;

class ProjectFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectFileError';
  }
}

function fail(path: string, message: string): never {
  throw new Error(`${path} ${message}`);
}

function asRecord(value: unknown, path: string, allowedKeys: readonly string[]): DataRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'must be an object');
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(path, 'must be a plain object');
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.includes(key)) {
      const displayKey = typeof key === 'string' ? key : String(key);
      fail(path, `has unrecognized property '${displayKey}'`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      fail(`${path}.${key}`, 'must be a data property');
    }
    if (!descriptor.enumerable) {
      fail(`${path}.${key}`, 'must be enumerable JSON data');
    }
  }

  return value as DataRecord;
}

function required(record: DataRecord, key: string, path: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return fail(`${path}.${key}`, 'is required');
  }
  return record[key];
}

function optional(record: DataRecord, key: string, path: string): unknown | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  return record[key];
}

function stringValue(value: unknown, path: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') return fail(path, 'must be a string');
  if (!allowEmpty && value.trim().length === 0) return fail(path, 'must not be empty');
  if (value.length > maxLength) return fail(path, `must be at most ${maxLength} characters`);
  return value;
}

function requiredString(record: DataRecord, key: string, path: string, maxLength: number, allowEmpty = false): string {
  return stringValue(required(record, key, path), `${path}.${key}`, maxLength, allowEmpty);
}

function optionalString(record: DataRecord, key: string, path: string, maxLength: number, allowEmpty = false): string | undefined {
  const value = optional(record, key, path);
  if (value === undefined) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return fail(`${path}.${key}`, 'must not be undefined');
    }
    return undefined;
  }
  return stringValue(value, `${path}.${key}`, maxLength, allowEmpty);
}

function numberValue(value: unknown, path: string, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'must be a finite number');
  if (integer && !Number.isSafeInteger(value)) return fail(path, 'must be a safe integer');
  if (value < minimum || value > maximum) return fail(path, `must be between ${minimum} and ${maximum}`);
  return value;
}

function requiredNumber(record: DataRecord, key: string, path: string, minimum: number, maximum: number, integer = false): number {
  return numberValue(required(record, key, path), `${path}.${key}`, minimum, maximum, integer);
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return fail(path, 'must be a boolean');
  return value;
}

function requiredBoolean(record: DataRecord, key: string, path: string): boolean {
  return booleanValue(required(record, key, path), `${path}.${key}`);
}

function arrayValue(value: unknown, path: string, maximumLength: number): unknown[] {
  if (!Array.isArray(value)) return fail(path, 'must be an array');
  if (value.length > maximumLength) return fail(path, `may contain at most ${maximumLength} entries`);

  const expectedKeys = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !expectedKeys.has(key)) {
      return fail(path, 'must contain only indexed entries');
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      return fail(`${path}[${index}]`, 'must not be missing');
    }
  }
  return value;
}

function uniqueId(value: string, path: string, ids: Set<string>): string {
  if (ids.has(value)) return fail(path, `duplicates id '${value}'`);
  ids.add(value);
  return value;
}

function parseViewport(value: unknown): Project['viewport'] {
  const path = 'viewport';
  const record = asRecord(value, path, ['width', 'height']);
  return {
    width: requiredNumber(record, 'width', path, 160, 4096, true),
    height: requiredNumber(record, 'height', path, 120, 4096, true),
  };
}

function parseVariable(value: unknown, index: number, names: Set<string>): Project['variables'][number] {
  const path = `variables[${index}]`;
  const record = asRecord(value, path, ['name', 'secret', 'description']);
  const name = requiredString(record, 'name', path, 64);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    fail(`${path}.name`, 'must be a valid variable identifier');
  }
  if (names.has(name)) fail(path, `has duplicate variable '${name}'`);
  names.add(name);

  return {
    name,
    secret: requiredBoolean(record, 'secret', path),
    description: requiredString(record, 'description', path, 2_000, true),
  };
}

function parseStep(value: unknown, index: number, variableNames: Set<string>, ids: Set<string>): Project['steps'][number] {
  const path = `steps[${index}]`;
  const record = asRecord(value, path, ['id', 'name', 'action', 'target', 'value', 'variable', 'timeoutMs', 'pauseMs']);
  const id = uniqueId(requiredString(record, 'id', path, 128), `${path}.id`, ids);
  const name = requiredString(record, 'name', path, 200);
  const rawAction = requiredString(record, 'action', path, 16);
  const actions: readonly Action[] = ['navigate', 'click', 'fill', 'select', 'wait'];
  if (!actions.includes(rawAction as Action)) fail(`${path}.action`, 'must be navigate, click, fill, select, or wait');
  const action = rawAction as Action;
  const target = optionalString(record, 'target', path, MAX_LOCATOR_LENGTH);
  const inputValue = optionalString(record, 'value', path, MAX_STRING_LENGTH, true);
  const variable = optionalString(record, 'variable', path, 64);
  const timeoutMs = requiredNumber(record, 'timeoutMs', path, 1, 120_000, true);
  const pauseMs = requiredNumber(record, 'pauseMs', path, 0, 60_000, true);

  if (action === 'navigate') {
    if (!target) fail(`${path}.target`, 'is required for navigate and must be an absolute HTTP or HTTPS URL');
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return fail(`${path}.target`, 'must be an absolute HTTP or HTTPS URL');
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      fail(`${path}.target`, 'must be an absolute HTTP or HTTPS URL');
    }
    if (url.username || url.password) {
      fail(`${path}.target`, 'must not contain embedded credentials');
    }
    if (inputValue !== undefined || variable !== undefined) {
      fail(path, 'navigate does not accept value or variable inputs');
    }
  } else if (action === 'click') {
    if (!target) fail(`${path}.target`, 'is required for click');
    if (inputValue !== undefined || variable !== undefined) {
      fail(path, 'click does not accept value or variable inputs');
    }
  } else if (action === 'fill' || action === 'select') {
    if (!target) fail(`${path}.target`, `is required for ${action}`);
    if ((inputValue === undefined) === (variable === undefined)) {
      fail(path, `${action} requires exactly one of value or variable`);
    }
    if (variable !== undefined && !variableNames.has(variable)) {
      fail(`${path}.variable`, `references undeclared variable '${variable}'`);
    }
  } else if (inputValue !== undefined || variable !== undefined) {
    fail(path, 'wait does not accept value or variable inputs');
  }

  return {
    id,
    name,
    action,
    ...(target !== undefined ? { target } : {}),
    ...(inputValue !== undefined ? { value: inputValue } : {}),
    ...(variable !== undefined ? { variable } : {}),
    timeoutMs,
    pauseMs,
  };
}

function parseTimeRange(record: DataRecord, path: string): { startMs: number; endMs: number } {
  const startMs = requiredNumber(record, 'startMs', path, 0, MAX_EDIT_TIME_MS, true);
  const endMs = requiredNumber(record, 'endMs', path, 0, MAX_EDIT_TIME_MS, true);
  if (endMs <= startMs) fail(`${path}.endMs`, 'must be greater than startMs');
  return { startMs, endMs };
}

function parseGeometryRecord(record: DataRecord, path: string, viewport: Project['viewport']): { x: number; y: number; width: number; height: number } {
  const x = requiredNumber(record, 'x', path, 0, viewport.width);
  const y = requiredNumber(record, 'y', path, 0, viewport.height);
  const width = requiredNumber(record, 'width', path, Number.MIN_VALUE, viewport.width);
  const height = requiredNumber(record, 'height', path, Number.MIN_VALUE, viewport.height);
  if (x + width > viewport.width || y + height > viewport.height) {
    fail(path, `must fit inside the ${viewport.width}x${viewport.height} viewport`);
  }
  return { x, y, width, height };
}

function parseGeometry(value: unknown, path: string, viewport: Project['viewport']): { x: number; y: number; width: number; height: number } {
  return parseGeometryRecord(asRecord(value, path, ['x', 'y', 'width', 'height']), path, viewport);
}

function parseMask(value: unknown, index: number, viewport: Project['viewport'], ids: Set<string>): Project['edits']['masks'][number] {
  const path = `edits.masks[${index}]`;
  const record = asRecord(value, path, ['id', 'x', 'y', 'width', 'height', 'startMs', 'endMs']);
  const id = uniqueId(requiredString(record, 'id', path, 128), `${path}.id`, ids);
  const geometry = parseGeometryRecord(record, path, viewport);
  return { id, ...geometry, ...parseTimeRange(record, path) };
}

function parseAnnotation(value: unknown, index: number, ids: Set<string>): Project['edits']['annotations'][number] {
  const path = `edits.annotations[${index}]`;
  const record = asRecord(value, path, ['id', 'text', 'startMs', 'endMs']);
  const id = uniqueId(requiredString(record, 'id', path, 128), `${path}.id`, ids);
  const text = requiredString(record, 'text', path, MAX_STRING_LENGTH);
  return { id, text, ...parseTimeRange(record, path) };
}

function parseZoom(value: unknown, index: number, viewport: Project['viewport']): Project['edits']['zooms'][number] {
  const path = `edits.zooms[${index}]`;
  const record = asRecord(value, path, ['startMs', 'endMs', 'scale', 'x', 'y']);
  const range = parseTimeRange(record, path);
  return {
    ...range,
    scale: requiredNumber(record, 'scale', path, 1, 8),
    x: requiredNumber(record, 'x', path, 0, viewport.width),
    y: requiredNumber(record, 'y', path, 0, viewport.height),
  };
}

function parseCrop(value: unknown, viewport: Project['viewport']): NonNullable<Project['edits']['crop']> {
  return parseGeometry(value, 'edits.crop', viewport);
}

function parseAudio(value: unknown): NonNullable<Project['edits']['audio']> {
  const path = 'edits.audio';
  const record = asRecord(value, path, ['file', 'startMs', 'volume']);
  return {
    file: requiredString(record, 'file', path, 4_096),
    startMs: requiredNumber(record, 'startMs', path, 0, MAX_EDIT_TIME_MS, true),
    volume: requiredNumber(record, 'volume', path, 0, 1),
  };
}

function parseEdits(value: unknown, viewport: Project['viewport'], ids: Set<string>): Project['edits'] {
  const path = 'edits';
  const record = asRecord(value, path, ['trimStartMs', 'trimEndMs', 'crop', 'masks', 'annotations', 'zooms', 'cursorHighlight', 'audio']);
  const trimStartMs = requiredNumber(record, 'trimStartMs', path, 0, MAX_EDIT_TIME_MS, true);
  const rawTrimEndMs = optional(record, 'trimEndMs', path);
  let trimEndMs: number | undefined;
  if (rawTrimEndMs !== undefined) {
    trimEndMs = numberValue(rawTrimEndMs, `${path}.trimEndMs`, 0, MAX_EDIT_TIME_MS, true);
    if (trimEndMs <= trimStartMs) fail(`${path}.trimEndMs`, 'must be greater than trimStartMs');
  } else if (Object.prototype.hasOwnProperty.call(record, 'trimEndMs')) {
    fail(`${path}.trimEndMs`, 'must not be undefined');
  }

  const rawCrop = optional(record, 'crop', path);
  let crop: Project['edits']['crop'];
  if (rawCrop !== undefined) crop = parseCrop(rawCrop, viewport);
  else if (Object.prototype.hasOwnProperty.call(record, 'crop')) fail(`${path}.crop`, 'must not be undefined');

  const masks = arrayValue(required(record, 'masks', path), `${path}.masks`, MAX_MASKS)
    .map((item, index) => parseMask(item, index, viewport, ids));
  const annotations = arrayValue(required(record, 'annotations', path), `${path}.annotations`, MAX_ANNOTATIONS)
    .map((item, index) => parseAnnotation(item, index, ids));
  const zooms = arrayValue(required(record, 'zooms', path), `${path}.zooms`, MAX_ZOOMS)
    .map((item, index) => parseZoom(item, index, viewport));
  const cursorHighlight = requiredBoolean(record, 'cursorHighlight', path);
  const rawAudio = optional(record, 'audio', path);
  let audio: Project['edits']['audio'];
  if (rawAudio !== undefined) audio = parseAudio(rawAudio);
  else if (Object.prototype.hasOwnProperty.call(record, 'audio')) fail(`${path}.audio`, 'must not be undefined');

  return {
    trimStartMs,
    ...(trimEndMs !== undefined ? { trimEndMs } : {}),
    ...(crop !== undefined ? { crop } : {}),
    masks,
    annotations,
    zooms,
    cursorHighlight,
    ...(audio !== undefined ? { audio } : {}),
  };
}

export function createProject(name = 'Untitled project'): Project {
  return parseProject({
    schemaVersion: 1,
    name,
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
}

export function parseProject(input: unknown): Project {
  const record = asRecord(input, 'project', ['schemaVersion', 'name', 'viewport', 'steps', 'variables', 'edits']);
  const schemaVersion = required(record, 'schemaVersion', 'project');
  if (schemaVersion !== 1) fail('project.schemaVersion', 'must be version 1');

  const name = requiredString(record, 'name', 'project', MAX_PROJECT_NAME_LENGTH);
  const viewport = parseViewport(required(record, 'viewport', 'project'));
  const variableNames = new Set<string>();
  const variables = arrayValue(required(record, 'variables', 'project'), 'variables', MAX_VARIABLES)
    .map((item, index) => parseVariable(item, index, variableNames));
  const ids = new Set<string>();
  const steps = arrayValue(required(record, 'steps', 'project'), 'steps', MAX_STEPS)
    .map((item, index) => parseStep(item, index, variableNames, ids));
  const edits = parseEdits(required(record, 'edits', 'project'), viewport, ids);

  return { schemaVersion: 1, name, viewport, steps, variables, edits };
}

export function serializeProject(project: Project): string {
  const validated = parseProject(project);
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PROJECT_BYTES) {
    throw new Error('Serialized project exceeds the 5 MiB project file limit');
  }
  return serialized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readProjectFile(file: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(file, 'r');
    const buffer = Buffer.alloc(MAX_PROJECT_BYTES + 1);
    let bytesReadTotal = 0;
    while (bytesReadTotal < buffer.length) {
      const { bytesRead } = await handle.read(buffer, bytesReadTotal, buffer.length - bytesReadTotal, bytesReadTotal);
      if (bytesRead === 0) break;
      bytesReadTotal += bytesRead;
    }
    if (bytesReadTotal > MAX_PROJECT_BYTES) {
      throw new ProjectFileError(`Project file "${file}" exceeds the 5 MiB limit`);
    }
    return buffer.subarray(0, bytesReadTotal).toString('utf8');
  } catch (error) {
    if (error instanceof ProjectFileError) throw error;
    throw new ProjectFileError(`Could not read project file "${file}": ${errorMessage(error)}`, { cause: error });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function loadProject(file: string): Promise<Project> {
  const contents = await readProjectFile(file);
  let decoded: unknown;
  try {
    decoded = JSON.parse(contents);
  } catch (error) {
    throw new ProjectFileError(`Invalid JSON in project file "${file}": ${errorMessage(error)}`, { cause: error });
  }

  try {
    return parseProject(decoded);
  } catch (error) {
    throw new ProjectFileError(`Invalid project file "${file}": ${errorMessage(error)}`, { cause: error });
  }
}

export async function saveProject(file: string, project: Project): Promise<void> {
  const contents = serializeProject(project);
  const temporaryFile = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(temporaryFile, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryFile, file);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryFile).catch(() => undefined);
    throw new ProjectFileError(`Could not save project file "${file}": ${errorMessage(error)}`, { cause: error });
  }
}
