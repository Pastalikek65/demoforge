import { describe, expect, it, vi } from 'vitest';
import { createLinuxNamespaceObserver } from '../../scripts/linux-namespace-observer.mjs';

const ownedTree = [
  { pid: 100, parentPid: 42 },
  { pid: 200, parentPid: 100 },
  { pid: 300, parentPid: 200 },
];

describe('createLinuxNamespaceObserver', () => {
  it('uses only the fixed sudo readlink command for allowlisted links of an owned descendant', async () => {
    const runCommand = vi.fn(async (_command, [,, namespacePath]) => ({
      stdout: `${namespacePath.split('/').at(-1)}:[4026531837]\n`,
    }));
    const observe = createLinuxNamespaceObserver({ mode: 'sudo-readlink', runCommand });

    const links = await observe(ownedTree, 100, 300);

    expect(links).toEqual({
      user: 'user:[4026531837]',
      pid: 'pid:[4026531837]',
      mnt: 'mnt:[4026531837]',
      net: 'net:[4026531837]',
    });
    expect(runCommand).toHaveBeenCalledTimes(4);
    for (const [command, args, options] of runCommand.mock.calls) {
      expect(command).toBe('/usr/bin/sudo');
      expect(args).toEqual(['-n', '/usr/bin/readlink', expect.stringMatching(/^\/proc\/300\/ns\/(user|pid|mnt|net)$/)]);
      expect(options).toMatchObject({ shell: false, timeout: 2000, maxBuffer: 256, encoding: 'utf8' });
    }
  });

  it('rejects malformed PIDs, unowned targets, and path-injection namespace values before invoking an observer', async () => {
    const runCommand = vi.fn();
    const observe = createLinuxNamespaceObserver({ mode: 'sudo-readlink', runCommand });

    await expect(observe(ownedTree, 0, 300)).rejects.toThrow(/main PID/);
    await expect(observe(ownedTree, 100, -1)).rejects.toThrow(/target PID/);
    await expect(observe(ownedTree, 100, '300;touch /tmp/pwned')).rejects.toThrow(/target PID/);
    await expect(observe(ownedTree, 100, 999)).rejects.toThrow(/not in the owned process snapshot/);
    await expect(observe(ownedTree, 100, 300, ['user/../../etc/passwd'])).rejects.toThrow(/selected from/);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('fails closed when the explicit privileged observer is denied', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const runCommand = vi.fn().mockRejectedValue(denied);
    const observe = createLinuxNamespaceObserver({ mode: 'sudo-readlink', runCommand });

    await expect(observe(ownedTree, 100, 300, ['user'])).rejects.toMatchObject({
      code: 'EACCES',
      message: expect.stringMatching(/user namespace.*EACCES/),
    });
  });

  it('keeps the local default unprivileged and does not escalate after EACCES', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const readLink = vi.fn().mockRejectedValue(denied);
    const runCommand = vi.fn();
    const observe = createLinuxNamespaceObserver({ readLink, runCommand });

    await expect(observe(ownedTree, 100, 300, ['user'])).rejects.toMatchObject({ code: 'EACCES' });
    expect(readLink).toHaveBeenCalledWith('/proc/300/ns/user', 'utf8');
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('rejects incomplete or malformed namespace link output', async () => {
    const observe = createLinuxNamespaceObserver({
      mode: 'sudo-readlink',
      runCommand: vi.fn().mockResolvedValue({ stdout: 'user:[not-a-number]\n' }),
    });

    await expect(observe(ownedTree, 100, 300, ['user'])).rejects.toThrow(/invalid link target/);
  });
});
