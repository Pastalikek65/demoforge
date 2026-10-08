export function isReservedVariableName(name: string): boolean {
  return ['__proto__', 'prototype', 'constructor'].includes(name);
}
