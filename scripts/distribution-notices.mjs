import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { writeLicenseInventory } from './license-inventory.mjs';

const root = path.resolve('.');
const { inventory } = await writeLicenseInventory({ rootDir: root });
const sections = ['DemoForge distribution dependency notices\nOwn code: Apache-2.0; third-party code keeps the following terms.'];
for (const entry of inventory.lockedPackages.filter(entry => !entry.dev && entry.installed)) {
  const directory = path.join(root, entry.lockPath);
  const files = await readdir(directory);
  for (const file of files.filter(file => /^(LICENSE|COPYING|NOTICE|ThirdPartyNotices)/i.test(file))) {
    try { sections.push(`\n===== ${entry.name}@${entry.version} / ${file} =====\n${await readFile(path.join(directory, file), 'utf8')}`); }
    catch (error) { if (error.code !== 'EISDIR') throw error; }
  }
}
// Electron's binary license and complete Chromium/Node attribution supplement npm metadata.
for (const file of ['LICENSE', 'LICENSES.chromium.html']) {
  sections.push(`\n===== Electron runtime / ${file} =====\n${await readFile(path.join(root, 'node_modules/electron/dist', file), 'utf8')}`);
}
await writeFile(path.join(root, 'artifacts/licenses/THIRD_PARTY_LICENSES.txt'), sections.join('\n'), 'utf8');
console.log('Distribution notices generated with complete Electron runtime credits.');
