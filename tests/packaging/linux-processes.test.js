import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { snapshotOwnedProcesses } from '../../scripts/linux-processes.mjs';

const fixtures = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createProcFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'demoforge-proc-fixture-'));
  fixtures.push(directory);
  return directory;
}

async function writeProcess(procRoot, pid, options = {}) {
  const processDirectory = path.join(procRoot, String(pid));
  const taskDirectory = path.join(processDirectory, 'task');
  await mkdir(taskDirectory, { recursive: true });
  await writeFile(path.join(processDirectory, 'status'), [
    `Name:\t${options.comm ?? 'chrome'}`,
    `Pid:\t${pid}`,
    `PPid:\t${options.parentPid ?? 1}`,
    `Seccomp:\t${options.seccompMode ?? 0}`,
    '',
  ].join('\n'));
  await writeFile(path.join(processDirectory, 'comm'), `${options.comm ?? 'chrome'}\n`);
  await writeFile(path.join(processDirectory, 'cmdline'), Buffer.from(`${(options.args ?? ['chrome']).join('\0')}\0`));

  const childrenByTid = new Map([[pid, options.children ?? []]]);
  for (const thread of options.threads ?? []) childrenByTid.set(thread.tid, thread.children ?? []);
  for (const [tid, children] of childrenByTid) {
    const threadPath = path.join(taskDirectory, String(tid));
    await mkdir(threadPath, { recursive: true });
    await writeFile(path.join(threadPath, 'children'), children.join(' '));
  }
  return processDirectory;
}

describe('snapshotOwnedProcesses', () => {
  it('finds a renderer forked from a non-leader Chromium thread and reads its seccomp mode', async () => {
    const procRoot = await createProcFixture();
    await writeProcess(procRoot, 100, { comm: 'demoforge', args: ['demoforge'], parentPid: 42, children: [200] });
    await writeProcess(procRoot, 200, { comm: 'electron', args: ['electron', '--type=utility'], parentPid: 100, children: [300] });
    await writeProcess(procRoot, 300, {
      comm: 'chrome', args: ['/runtime/chrome', '--type=zygote'], parentPid: 200,
      threads: [{ tid: 301, children: [400] }, { tid: 'invalid-tid', children: [500] }],
    });
    await writeProcess(procRoot, 400, {
      comm: 'Chrome_Renderer', args: ['/runtime/chrome', '--type=renderer'], parentPid: 300, seccompMode: 2,
    });
    await writeProcess(procRoot, 500, { comm: 'unrelated-renderer', args: ['unrelated-renderer'], parentPid: 300, seccompMode: 0 });

    const processes = await snapshotOwnedProcesses(100, procRoot);
    const renderer = processes.find((process) => process.pid === 400);
    expect(renderer).toMatchObject({
      pid: 400,
      parentPid: 300,
      comm: 'Chrome_Renderer',
      args: ['/runtime/chrome', '--type=renderer'],
      seccompMode: 2,
    });
    expect(processes.map((process) => process.pid)).not.toContain(500);
  });

  it('tolerates a child that exits during a snapshot and never scans unrelated proc entries', async () => {
    const procRoot = await createProcFixture();
    await writeProcess(procRoot, 100, { comm: 'demoforge', args: ['demoforge'], parentPid: 42, children: [200] });
    await mkdir(path.join(procRoot, '200'));
    const unrelated = path.join(procRoot, '900');
    await mkdir(path.join(unrelated, 'status'), { recursive: true });

    const processes = await snapshotOwnedProcesses(100, procRoot);
    expect(processes.map((process) => process.pid)).toEqual([100]);
  });

  it('propagates procfs access and format errors other than an ENOENT race', async () => {
    const procRoot = await createProcFixture();
    await writeProcess(procRoot, 100, { comm: 'demoforge', args: ['demoforge'], parentPid: 42, children: [200] });
    await mkdir(path.join(procRoot, '200', 'status'), { recursive: true });
    await expect(snapshotOwnedProcesses(100, procRoot)).rejects.toThrow();
  });

  it('rejects invalid process identifiers and caps traversal at 4096 visited PIDs', async () => {
    const procRoot = await createProcFixture();
    await expect(snapshotOwnedProcesses('100/../900', procRoot)).rejects.toThrow(/mainPID/);
    const tooManyChildren = Array.from({ length: 4096 }, (_, index) => String(2000 + index));
    await writeProcess(procRoot, 100, { comm: 'demoforge', args: ['demoforge'], parentPid: 42, children: tooManyChildren });
    await expect(snapshotOwnedProcesses(100, procRoot)).rejects.toThrow(/4096/);
  });
});
