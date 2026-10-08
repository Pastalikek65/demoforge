import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_VISITED_PROCESSES = 4096;

function parsePositiveId(value, label) {
  if (!/^[1-9]\d*$/.test(String(value))) throw new TypeError(`${label} must be a positive integer.`);
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError(`${label} must be a positive integer.`);
  return id;
}

function parseStatus(status) {
  const parentPid = Number(status.match(/^PPid:\s+(\d+)$/m)?.[1] ?? 0);
  const seccompMode = Number(status.match(/^Seccomp:\s+(\d+)$/m)?.[1] ?? 0);
  return {
    parentPid: Number.isSafeInteger(parentPid) && parentPid >= 0 ? parentPid : 0,
    seccompMode: Number.isSafeInteger(seccompMode) && seccompMode >= 0 ? seccompMode : 0,
  };
}

async function readProcess(pid, parentPid, procRoot, isRoot) {
  const processDirectory = path.join(procRoot, String(pid));
  try {
    const status = await readFile(path.join(processDirectory, 'status'), 'utf8');
    const metadata = parseStatus(status);
    if (!isRoot && metadata.parentPid !== parentPid) return undefined;
    const [comm, commandLine] = await Promise.all([
      readFile(path.join(processDirectory, 'comm'), 'utf8'),
      readFile(path.join(processDirectory, 'cmdline')),
    ]);
    return {
      pid,
      parentPid: metadata.parentPid,
      comm: comm.trim(),
      args: commandLine.toString('utf8').split('\0').filter(Boolean),
      seccompMode: metadata.seccompMode,
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
