import { isReservedVariableName } from '../shared/variables.js';
export function trustedSender(actual: string, expected: string, isMainFrame: boolean): boolean {
  return isMainFrame && actual === expected;
}
export function validateVariables(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Runtime variables must be a string dictionary.');
  const entries = Object.entries(input);
  if (entries.length > 500) throw new Error('Too many runtime variables.');
  const result: Record<string, string> = {};
  let totalBytes = 0;
  for (const [name, value] of entries) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name) || isReservedVariableName(name)) throw new Error('Invalid runtime variable name.');
    if (typeof value !== 'string' || value.length > 1000000) throw new Error('Runtime variable values must be bounded strings.');
    totalBytes += Buffer.byteLength(value, 'utf8');
    if (totalBytes > 5 * 1024 * 1024) throw new Error('Total runtime variable input is too large.');
    result[name] = value;
  }
  return result;
}
