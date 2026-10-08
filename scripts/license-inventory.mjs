import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, '..');
const creditName = /^(?:licenses?(?:[._-].*)?|copying(?:[._-].*)?|notices?(?:[._-].*)?|authors?(?:[._-].*)?|copyright(?:[._-].*)?|patents?(?:[._-].*)?|third[._-]?party(?:[._-].*)?)$/i;

async function readJson(file) {
  const contents = await readFile(file, 'utf8');
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Could not parse ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function packageNameFromLockPath(lockPath) {
  const leaf = lockPath.split('node_modules/').at(-1) ?? lockPath;
  const parts = leaf.split('/');
  return parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function licenseDeclaration(packageJson, lockNode) {
  for (const [metadata, source] of [[packageJson, 'installed package.json'], [lockNode, 'package-lock.json']]) {
    if (!metadata || typeof metadata !== 'object') continue;
    if (metadata.license !== undefined && metadata.license !== null && metadata.license !== '') {
      const license = displayLicense(metadata.license);
      if (license) return { license, licenseSource: source };
    }
    if (Array.isArray(metadata.licenses) && metadata.licenses.length > 0) {
      return { license: metadata.licenses.map(displayLicense).filter(Boolean).join('; ') || 'UNKNOWN', licenseSource: source };
    }
  }
  return { license: 'UNKNOWN', licenseSource: 'not declared' };
}

function displayLicense(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    if (typeof value.type === 'string' && value.type) return value.type;
    if (typeof value.url === 'string' && value.url) return value.url;
  }
  return '';
}

async function installedPackage(rootDir, lockPath) {
  if (!lockPath.startsWith('node_modules/')) throw new Error(`Unexpected package-lock entry: ${lockPath}`);
  const packageDirectory = path.resolve(rootDir, ...lockPath.split('/'));
  const relativeDirectory = path.relative(rootDir, packageDirectory);
  if (relativeDirectory.startsWith('..') || path.isAbsolute(relativeDirectory)) {
    throw new Error(`Package-lock entry leaves the project root: ${lockPath}`);
  }
  try {
    return await readJson(path.join(packageDirectory, 'package.json'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function findCreditFiles(directory, relativePrefix = '') {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relativePath = path.posix.join(relativePrefix, entry.name);
    if (entry.isFile() && creditName.test(entry.name)) found.push(relativePath);
    else if (entry.isDirectory()) found.push(...await findCreditFiles(path.join(directory, entry.name), relativePath));
  }
  return found.sort((left, right) => left.localeCompare(right));
}

async function vendorRuntime(rootDir) {
  const runtimeDirectory = path.join(rootDir, 'artifacts', 'runtime');
  let entries = [];
  try {
    entries = await readdir(runtimeDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const readmeEntry = entries.find((entry) => entry.isFile() && /^readme(?:[._-].*)?$/i.test(entry.name));
  const runtimeReadme = readmeEntry ? `artifacts/runtime/${readmeEntry.name}` : undefined;
  const componentDirectories = entries.filter((entry) => entry.isDirectory() && /^(?:chromium|ffmpeg)-\d+$/i.test(entry.name));
  const components = [];
  for (const entry of componentDirectories) {
    const chromium = /^chromium-/i.test(entry.name);
    components.push({
      name: chromium ? 'Playwright Chromium' : 'Playwright FFmpeg helper',
      path: `artifacts/runtime/${entry.name}`,
      bundled: false,
      creditFiles: await findCreditFiles(path.join(runtimeDirectory, entry.name), entry.name),
    });
  }
  components.sort((left, right) => left.path.localeCompare(right.path));

  const unresolved = components
    .filter((component) => component.creditFiles.length === 0)
    .map((component) => `${component.name} (${component.path}) has no standard license, notice, author, copyright, copying, patent, or third-party credit filename in the staged runtime tree.`);
  if (components.length > 0) unresolved.push('These legacy development cache folders are not included in current packages. Browser/runtime helpers are downloaded directly from the vendor during explicit setup.');
  unresolved.push('The external export FFmpeg executable is not bundled. Its vendor source credits and enabled codec licensing depend on the locally selected executable and remain outside this inventory.');

  return {
    runtimeDirectoryPresent: entries.length > 0,
    readme: runtimeReadme,
    components,
    externalExportFfmpeg: {
      bundled: false,
      selectedBy: 'DEMOFORGE_FFMPEG or PATH',
      sourceCredits: 'not inventoried; executable is external and environment-specific',
      reviewRequired: true,
    },
    unresolved,
    reviewRequired: unresolved.length > 0,
  };
}

export async function buildLicenseInventory(rootDirectory = defaultRoot) {
  const rootDir = path.resolve(rootDirectory);
  const project = await readJson(path.join(rootDir, 'package.json'));
  const lock = await readJson(path.join(rootDir, 'package-lock.json'));
  if (!lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) {
    throw new Error('package-lock.json does not contain a packages object.');
  }

  const lockedPackages = [];
  for (const [lockPath, lockNode] of Object.entries(lock.packages)) {
    if (!lockPath.startsWith('node_modules/')) continue;
    const installed = await installedPackage(rootDir, lockPath);
    const declaration = licenseDeclaration(installed, lockNode);
    lockedPackages.push({
      name: installed?.name ?? lockNode?.name ?? packageNameFromLockPath(lockPath),
      version: installed?.version ?? lockNode?.version ?? 'UNKNOWN',
      license: declaration.license,
      licenseSource: declaration.licenseSource,
      installed: installed !== undefined,
      lockPath,
      dev: lockNode?.dev === true,
      optional: lockNode?.optional === true,
    });
  }
  lockedPackages.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version) || left.lockPath.localeCompare(right.lockPath));

  return {
    schemaVersion: 1,
    project: { name: project.name ?? 'UNKNOWN', version: project.version ?? 'UNKNOWN', license: displayLicense(project.license) || 'UNKNOWN' },
    packageLock: { lockfileVersion: lock.lockfileVersion ?? 'UNKNOWN', packageCount: lockedPackages.length },
    lockedPackages,
    vendorRuntime: await vendorRuntime(rootDir),
  };
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
}

export function renderLicenseMarkdown(inventory) {
  const lines = [
    '# DemoForge package license inventory',
    '',
    `Project: ${inventory.project.name} ${inventory.project.version} (declared license: ${inventory.project.license})`,
    `Locked package entries: ${inventory.packageLock.packageCount} (package-lock version ${inventory.packageLock.lockfileVersion})`,
    '',
    'This inventory records package metadata declarations. `UNKNOWN` means neither the installed package manifest nor the lock entry declared a license field; it is not a conclusion about the applicable license terms.',
    '',
    '## Locked packages',
    '',
    '| Package | Version | Declared license | Metadata source | Installed |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const entry of inventory.lockedPackages) {
    lines.push(`| ${markdownCell(entry.name)} | ${markdownCell(entry.version)} | ${markdownCell(entry.license)} | ${markdownCell(entry.licenseSource)} | ${entry.installed ? 'yes' : 'no'} |`);
  }
  if (inventory.lockedPackages.length === 0) lines.push('| (none) | — | — | — | — |');

  lines.push('', '## Staged browser runtime', '');
  if (inventory.vendorRuntime.readme) lines.push(`Runtime README: ${inventory.vendorRuntime.readme}.`);
  if (inventory.vendorRuntime.components.length === 0) lines.push('No Playwright Chromium or FFmpeg helper runtime directory was found under `artifacts/runtime`.');
  for (const component of inventory.vendorRuntime.components) {
    lines.push(`- ${component.name} at ${component.path} is a development cache; it is not bundled.`);
    lines.push(`  - Standard license/credit files found: ${component.creditFiles.length ? component.creditFiles.join(', ') : 'none'}.`);
  }
  lines.push('', '## Review required', '');
  for (const item of inventory.vendorRuntime.unresolved) lines.push(`- ${item}`);
  lines.push('', 'Generated from `package-lock.json`, installed package `package.json` files, and staged runtime filenames. This report inventories declarations and file presence; it does not determine compliance or replace upstream license and attribution review.', '');
  return lines.join('\n');
}

export async function writeLicenseInventory({ rootDir = defaultRoot, outputDir } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedOutput = path.resolve(outputDir ?? path.join(resolvedRoot, 'artifacts', 'licenses'));
  const inventory = await buildLicenseInventory(resolvedRoot);
  const jsonPath = path.join(resolvedOutput, 'license-inventory.json');
  const markdownPath = path.join(resolvedOutput, 'license-inventory.md');
  await mkdir(resolvedOutput, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderLicenseMarkdown(inventory), 'utf8');
  return { json: jsonPath, markdown: markdownPath, inventory };
}

function parseArguments(args) {
  const options = { rootDir: defaultRoot, outputDir: undefined, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--root' || argument === '--output') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path.`);
      options[argument === '--root' ? 'rootDir' : 'outputDir'] = path.resolve(value);
      index += 1;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function main(args) {
  const options = parseArguments(args);
  if (options.help) {
    process.stdout.write('Usage: node scripts/license-inventory.mjs [--root <project-root>] [--output <output-directory>]\n');
    return;
  }
  const result = await writeLicenseInventory(options);
  process.stdout.write(`${JSON.stringify({ json: result.json, markdown: result.markdown, packageCount: result.inventory.packageLock.packageCount, reviewRequired: result.inventory.vendorRuntime.reviewRequired }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`License inventory failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
