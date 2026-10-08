import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_VISITED_PROCESSES = 4096;
const chromiumProcessTypes = new Set(['renderer', 'zygote', 'gpu-process', 'utility', 'broker']);
const safeChromiumRoleFlags = new Set([...chromiumProcessTypes].map((type) => `--type=${type}`));
const forbiddenChromiumSandboxFlags = new Set([
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-seccomp-filter-sandbox',
  '--disable-namespace-sandbox', '--disable-renderer-sandbox',
]);
const liveProcessStates = new Set(['R', 'S', 'D', 'T', 't', 'W', 'K', 'P', 'I']);
const deadProcessStates = new Set(['Z', 'X', 'x']);

function parsePositiveId(value, label) {
  if (!/^[1-9]\d*$/.test(String(value))) throw new TypeError(`${label} must be a positive integer.`);
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError(`${label} must be a positive integer.`);
  return id;
}

function parseStatus(status) {
  const parentPid = Number(status.match(/^PPid:\s+(\d+)$/m)?.[1] ?? 0);
  const seccompMode = Number(status.match(/^Seccomp:\s+(\d+)$/m)?.[1] ?? 0);
  const state = status.match(/^State:\s+([A-Za-z])(?:\s|$)/m)?.[1] ?? '?';
  return {
    parentPid: Number.isSafeInteger(parentPid) && parentPid >= 0 ? parentPid : 0,
    seccompMode: Number.isSafeInteger(seccompMode) && seccompMode >= 0 ? seccompMode : 0,
    state,
  };
}

function parseCommandLine(comm, commandLine) {
  const args = commandLine.toString('utf8').split('\0').filter(Boolean);
  if (args.length === 0) return { args, commandLineFormat: 'empty' };
  if (/^chrome(?:[-_].*)?$/i.test(comm) && args.length === 1 && /\s/.test(args[0])) {
    const titleArgs = args[0].split(/\s+/).filter(Boolean);
    const hasQuoteCharacters = /["']/.test(args[0]);
    return {
      args: titleArgs,
      commandLineFormat: hasQuoteCharacters ? 'chromium-title-ambiguous' : 'chromium-title',
    };
  }
  return { args, commandLineFormat: 'nul-separated' };
}

export function isLiveLinuxProcess(process) {
  return liveProcessStates.has(process?.state);
}

export function isKnownLinuxProcessState(process) {
  return liveProcessStates.has(process?.state) || deadProcessStates.has(process?.state);
}

export function chromiumProcessEvidence(process) {
  const args = Array.isArray(process?.args) ? process.args : [];
  const titleAmbiguous = process?.commandLineFormat === 'chromium-title-ambiguous';
  const typeArguments = titleAmbiguous ? [] : args.filter((argument) => argument.startsWith('--type='));
  const firstTypeArgument = args[1];
  const type = typeArguments.length === 1 && firstTypeArgument === typeArguments[0]
    ? typeArguments[0].slice('--type='.length)
    : undefined;
  const processType = chromiumProcessTypes.has(type) ? type : undefined;
  const roleFlags = titleAmbiguous ? [] : args.filter((argument) => safeChromiumRoleFlags.has(argument));
  const forbiddenSandboxFlags = [];
  for (const argument of args) {
    // A flattened Chromium title is not an escaped serialization of argv.
    // Treat whitespace tokens as possible switches and trim quote wrappers so
    // ambiguous boundaries cannot hide a real forbidden flag.
    const candidate = titleAmbiguous ? argument.replace(/^["']+|["']+$/g, '') : argument;
    for (const flag of forbiddenChromiumSandboxFlags) {
      if (candidate === flag || candidate.startsWith(`${flag}=`)) forbiddenSandboxFlags.push(flag);
    }
  }
  return {
    processType,
    roleFlags: [...new Set(roleFlags)],
    forbiddenSandboxFlags: [...new Set(forbiddenSandboxFlags)],
    commandLineAvailable: args.length > 0
      && process?.commandLineFormat !== 'chromium-title-ambiguous'
      && process?.commandLineFormat !== 'chromium-title-unparsed',
  };
}

async function readProcess(pid, parentPid, procRoot, isRoot) {
  const processDirectory = path.join(procRoot, String(pid));
  try {
    const status = await readFile(path.join(processDirectory, 'status'), 'utf8');
    const metadata = parseStatus(status);
    if (!isRoot && metadata.parentPid !== parentPid) return undefined;
    const [commContents, commandLine] = await Promise.all([
      readFile(path.join(processDirectory, 'comm'), 'utf8'),
      readFile(path.join(processDirectory, 'cmdline')),
    ]);
    const comm = commContents.trim();
    const parsedCommandLine = parseCommandLine(comm, commandLine);
    return {
      pid,
      parentPid: metadata.parentPid,
      comm,
      ...parsedCommandLine,
      seccompMode: metadata.seccompMode,
      state: metadata.state,
    };
  } catch (error) {
    if (!isRoot && error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function taskIdFromEntry(entry) {
  if (!entry.isDirectory()) return undefined;
  if (!/^[1-9]\d*$/.test(entry.name)) return undefined;
  const tid = Number(entry.name);
  return Number.isSafeInteger(tid) && tid > 0 ? tid : undefined;
}

async function readTaskChildren(pid, procRoot) {
  const taskRoot = path.join(procRoot, String(pid), 'task');
  let entries;
  try {
    entries = await readdir(taskRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const children = [];
  for (const entry of entries) {
    const tid = taskIdFromEntry(entry);
    if (tid === undefined) continue;
    const childrenPath = path.join(taskRoot, String(tid), 'children');
    let contents;
    try {
      contents = await readFile(childrenPath, 'utf8');
    } catch (error) {
      // A thread or its procfs entry can disappear while a live tree is sampled.
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const token of contents.trim().split(/\s+/).filter(Boolean)) {
      children.push(parsePositiveId(token, 'child PID'));
    }
  }
  return children;
}

export async function snapshotOwnedProcesses(mainPID, procRoot = '/proc') {
  const rootPid = parsePositiveId(mainPID, 'mainPID');
  if (typeof procRoot !== 'string' || procRoot.length === 0) throw new TypeError('procRoot must be a non-empty path.');

  const visited = new Set([rootPid]);
  const pending = [{ pid: rootPid, parentPid: undefined, isRoot: true }];
  const snapshot = [];
  while (pending.length > 0) {
    const current = pending.shift();
    const process = await readProcess(current.pid, current.parentPid, procRoot, current.isRoot);
    if (!process) continue;
    snapshot.push(process);

    for (const childPid of await readTaskChildren(current.pid, procRoot)) {
      if (visited.has(childPid)) continue;
      if (visited.size >= MAX_VISITED_PROCESSES) throw new Error(`Owned process snapshot exceeded ${MAX_VISITED_PROCESSES} processes.`);
      visited.add(childPid);
      pending.push({ pid: childPid, parentPid: current.pid, isRoot: false });
    }
  }
  return snapshot;
}
