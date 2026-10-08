import { createHash } from 'node:crypto';
import type { Project } from '../shared/types.js';

/** Hashes only project fields that can change browser replay behavior. */
export function workflowHash(project: Project): string {
  const behavior = {
    viewport: {
      width: project.viewport.width,
      height: project.viewport.height,
    },
    steps: project.steps.map((step) => ({
      action: step.action,
      ...(step.target !== undefined ? { target: step.target } : {}),
      ...(step.value !== undefined ? { value: step.value } : {}),
      ...(step.variable !== undefined ? { variable: step.variable } : {}),
      timeoutMs: step.timeoutMs,
      pauseMs: step.pauseMs,
    })),
    variables: project.variables
      .map(({ name, secret }) => ({ name, secret }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
  };
  return createHash('sha256').update(JSON.stringify(behavior), 'utf8').digest('hex');
}
