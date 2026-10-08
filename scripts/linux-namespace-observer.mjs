import { execFile as execFileCallback } from 'node:child_process';
import { readlink as readlinkFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const allowedNamespaces = new Set(['user', 'pid', 'mnt', 'net']);
const observerModes = new Set(['direct', 'sudo-readlink']);

function requirePid(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer.`);
  return value;
}

function assertOwnedProcess(processSnapshot, rootPid, targetPid) {
  if (!Array.isArray(processSnapshot)) throw new TypeError('The owned process snapshot must be an array.');
  const byPid = new Map();
  for (const entry of processSnapshot) {
    const pid = requirePid(entry?.pid, 'snapshot PID');
    if (byPid.has(pid)) throw new Error('The owned process snapshot contains a duplicate PID.');
    byPid.set(pid, entry);
  }
  if (!byPid.has(rootPid)) throw new Error('The owned process snapshot does not contain its root PID.');

  const visited = new Set();
  let currentPid = targetPid;
  while (currentPid !== rootPid) {
    if (visited.has(currentPid)) throw new Error('The owned process snapshot contains a parent cycle.');
    visited.add(currentPid);
    const entry = byPid.get(currentPid);
    if (!entry) throw new Error('The namespace target is not in the owned process snapshot.');
    const parentPid = requirePid(entry.parentPid, 'snapshot parent PID');
    if (!byPid.has(parentPid)) throw new Error('The namespace target has no complete owned parent chain.');
    currentPid = parentPid;
  }
}

function namespaceReadError(namespace, error) {
  const code = typeof error?.code === 'string' ? error.code : 'observer failure';
  const wrapped = new Error(`Could not inspect the ${namespace} namespace of an owned Linux process (${code}).`, { cause: error });
  if (typeof error?.code === 'string') wrapped.code = error.code;
  return wrapped;
}

function validateLink(namespace, value) {
  if (typeof value !== 'string' || !new RegExp(`^${namespace}:\\[[1-9]\\d*\\]$`).test(value.trim())) {
    throw new Error(`The ${namespace} namespace observer returned an invalid link target.`);
  }
  return value.trim();
}

/**
 * Creates a namespace-link reader for an already sampled, app-owned process tree.
 * The default mode stays unprivileged. `sudo-readlink` is an explicit CI opt-in;
 * it runs only the fixed readlink executable against constructed allowlisted paths.
 */
export function createLinuxNamespaceObserver({ mode = 'direct', readLink = readlinkFile, runCommand = execFile } = {}) {
  if (!observerModes.has(mode)) throw new TypeError('Namespace observer mode must be direct or sudo-readlink.');
  if (typeof readLink !== 'function' || typeof runCommand !== 'function') throw new TypeError('Namespace observer functions must be callable.');

  return async function readOwnedNamespaceLinks(processSnapshot, mainPid, targetPid, namespaces = ['user', 'pid', 'mnt', 'net']) {
    const root = requirePid(mainPid, 'main PID');
    const target = requirePid(targetPid, 'target PID');
    assertOwnedProcess(processSnapshot, root, target);
    if (!Array.isArray(namespaces) || namespaces.length === 0) throw new TypeError('At least one namespace must be requested.');
    for (const namespace of namespaces) {
      if (typeof namespace !== 'string' || !allowedNamespaces.has(namespace)) throw new TypeError('Namespace names must be selected from user, pid, mnt, and net.');
    }

    const links = {};
    for (const namespace of namespaces) {
      const namespacePath = `/proc/${target}/ns/${namespace}`;
      let link;
      try {
        if (mode === 'sudo-readlink') {
          const result = await runCommand('/usr/bin/sudo', ['-n', '/usr/bin/readlink', namespacePath], {
            encoding: 'utf8',
            timeout: 2_000,
            maxBuffer: 256,
            windowsHide: true,
            shell: false,
          });
          link = typeof result === 'string' ? result : result?.stdout;
        } else {
          link = await readLink(namespacePath, 'utf8');
        }
      } catch (error) {
        throw namespaceReadError(namespace, error);
      }
      links[namespace] = validateLink(namespace, link);
    }
    return links;
  };
}

export const linuxNamespaceObserverMode = process.env.DEMOFORGE_LINUX_NAMESPACE_OBSERVER || 'direct';
