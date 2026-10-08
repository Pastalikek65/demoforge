import { afterEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/license-inventory.mjs');

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'demoforge-license-inventory-'));
  fixtures.push(root);
  await mkdir(path.join(root, 'node_modules', '@scope', 'manifest-license'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'no-license'), { recursive: true });
  await mkdir(path.join(root, 'artifacts', 'runtime', 'chromium-1234'), { recursive: true });
  await mkdir(path.join(root, 'artifacts', 'runtime', 'ffmpeg-5678'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'inventory-fixture', version: '1.0.0', license: 'Apache-2.0' }));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({
    name: 'inventory-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'inventory-fixture', version: '1.0.0', license: 'Apache-2.0' },
      'node_modules/@scope/manifest-license': { version: '2.3.4', license: 'MIT' },
      'node_modules/no-license': { version: '5.6.7' },
      'node_modules/lock-only': { version: '8.0.0', license: 'MPL-2.0' },
    },
  }));
  await writeFile(path.join(root, 'node_modules', '@scope', 'manifest-license', 'package.json'), JSON.stringify({ name: '@scope/manifest-license', version: '2.3.4', license: 'BSD-3-Clause' }));
  await writeFile(path.join(root, 'node_modules', 'no-license', 'package.json'), JSON.stringify({ name: 'no-license', version: '5.6.7' }));
  await writeFile(path.join(root, 'artifacts', 'runtime', 'chromium-1234', 'LICENSE'), 'vendor license fixture');
  await writeFile(path.join(root, 'artifacts', 'runtime', 'ffmpeg-5678', 'COPYING.LGPLv2.1'), 'helper license fixture');
  await writeFile(path.join(root, 'artifacts', 'runtime', 'README.txt'), 'Runtime fixture');
  return root;
}

async function runInventory(root: string, output: string) {
  await execFile(process.execPath, [scriptPath, '--root', root, '--output', output], { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(await readFile(path.join(output, 'license-inventory.json'), 'utf8'));
}

test('inventories lockfile packages from installed license metadata and marks missing declarations for review', async () => {
  const root = await makeFixture();
  const output = path.join(root, 'reports', 'licenses');

  const inventory = await runInventory(root, output);
  const installedLicense = inventory.lockedPackages.find((entry: any) => entry.name === '@scope/manifest-license');
  const missingLicense = inventory.lockedPackages.find((entry: any) => entry.name === 'no-license');
  const lockFallback = inventory.lockedPackages.find((entry: any) => entry.name === 'lock-only');

  expect(inventory.project).toMatchObject({ name: 'inventory-fixture', version: '1.0.0', license: 'Apache-2.0' });
  expect(installedLicense).toMatchObject({ version: '2.3.4', license: 'BSD-3-Clause', licenseSource: 'installed package.json' });
  expect(missingLicense).toMatchObject({ version: '5.6.7', license: 'UNKNOWN', licenseSource: 'not declared' });
  expect(lockFallback).toMatchObject({ version: '8.0.0', license: 'MPL-2.0', licenseSource: 'package-lock.json', installed: false });
  expect(inventory.vendorRuntime.components).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Playwright Chromium', bundled: false, creditFiles: ['chromium-1234/LICENSE'] }),
    expect.objectContaining({ name: 'Playwright FFmpeg helper', bundled: false, creditFiles: ['ffmpeg-5678/COPYING.LGPLv2.1'] }),
  ]));
  expect(inventory.vendorRuntime.reviewRequired).toBe(true);
  expect(inventory.vendorRuntime.unresolved.join('\n')).toMatch(/not included in current packages/i);
  expect(inventory.vendorRuntime.unresolved.join('\n')).toMatch(/external export FFmpeg executable is not bundled/i);
});

test('writes machine-readable and human-readable inventories to the requested output directory', async () => {
  const root = await makeFixture();
  const output = path.join(root, 'reports', 'licenses');

  const json = await runInventory(root, output);
  const markdown = await readFile(path.join(output, 'license-inventory.md'), 'utf8');

  expect(json.schemaVersion).toBe(1);
  expect(json.lockedPackages).toHaveLength(3);
  expect(markdown).toContain('@scope/manifest-license');
  expect(markdown).toContain('UNKNOWN');
  expect(markdown).toMatch(/external export FFmpeg/i);
});
