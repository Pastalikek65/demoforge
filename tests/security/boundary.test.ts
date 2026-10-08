import { test, expect } from 'vitest';
import { trustedSender, validateVariables } from '../../src/electron/boundary.js';
test('only the exact loaded local editor frame can invoke desktop actions', () => {
  const loaded = 'file:///C:/app/dist/renderer/index.html';
  expect(trustedSender(loaded, loaded, true)).toBe(true);
  expect(trustedSender('https://attacker.test', loaded, true)).toBe(false);
  expect(trustedSender('file:///C:/secret', loaded, true)).toBe(false);
  expect(trustedSender(loaded, loaded, false)).toBe(false);
  expect(trustedSender('http://127.0.0.1:5173/evil', loaded, true)).toBe(false);
});
test('runtime variable dictionaries reject prototype pollution and nonstring payloads', () => {
  expect(validateVariables({ token: 'secret-runtime' })).toEqual({ token: 'secret-runtime' });
  expect(() => validateVariables(JSON.parse('{"__proto__":"x"}'))).toThrow();
  expect(() => validateVariables({ token: { nested: 'value' } })).toThrow();
  expect(() => validateVariables({ token: 'x'.repeat(1000001) })).toThrow();
});
test('project-valid underscore variables work and aggregate secret input is bounded', () => {
  expect(validateVariables({ _token: 'private' })).toEqual({ _token: 'private' });
  expect(Object.keys(validateVariables(Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`v${index}`, 'x']))))).toHaveLength(500);
  expect(() => validateVariables(Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`v${index}`, 'x'.repeat(700000)])))).toThrow(/total|aggregate|large/i);
});
