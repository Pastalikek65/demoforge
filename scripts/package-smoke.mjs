import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron, chromium } from 'playwright';

const execFile = promisify(execFileCallback);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const stepTimeoutMs = 10_000;
const operationTimeoutMs = 120_000;
const browserSetupTimeoutMs = 660_000;

function usage() {
  return 'Usage: node scripts/package-smoke.mjs <absolute-path-to-DemoForge-executable> [--ffmpeg <absolute-path-to-ffmpeg>]';
}

function parseArguments(args) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { help: true };
  const [executable, ...rest] = args;
  if (!executable || executable.startsWith('--')) throw new Error(usage());
  const options = { executable, ffmpeg: undefined, help: false };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== '--ffmpeg') throw new Error(`Unknown argument: ${rest[index]}\n${usage()}`);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--ffmpeg requires an absolute executable path.');
    if (options.ffmpeg) throw new Error('--ffmpeg may be specified only once.');
    options.ffmpeg = value;
    index += 1;
  }
  return options;
}

async function isRegularFile(file) {
  try { return (await lstat(file)).isFile(); }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function locateFfmpeg(explicitPath) {
  const candidate = explicitPath ?? process.env.DEMOFORGE_FFMPEG;
  if (candidate) {
    if (path.isAbsolute(candidate)) {
      if (!await isRegularFile(candidate)) throw new Error(`FFmpeg executable does not exist: ${candidate}`);
      return path.resolve(candidate);
    }
    if (candidate.includes('/') || candidate.includes('\\')) throw new Error('DEMOFORGE_FFMPEG must be an absolute file path.');
  }

  const command = candidate ?? (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  try {
    const resolver = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFile(resolver, [command], { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 });
    const resolved = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (resolved && await isRegularFile(resolved)) return path.resolve(resolved);
  } catch {
    // The diagnostic below gives the actionable prerequisite without hiding a test failure.
  }
  throw new Error('A local export FFmpeg executable is required. Pass --ffmpeg <absolute-path> or set DEMOFORGE_FFMPEG; this smoke run will not substitute the Playwright recording helper.');
}

async function requireFfmpegFeatures(ffmpegPath) {
  const version = await execFile(ffmpegPath, ['-version'], { windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
  const filters = await execFile(ffmpegPath, ['-filters'], { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  const encoders = await execFile(ffmpegPath, ['-encoders'], { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  assert.match(version.stdout, /ffmpeg version/i, 'the selected FFmpeg executable must identify itself as FFmpeg');
  assert.match(filters.stdout, /\bsubtitles\b/, 'the selected FFmpeg build must include subtitle rendering for the caption acceptance check');
  assert.match(encoders.stdout, /\blibx264\b/, 'the selected FFmpeg build must include libx264 for the MP4 acceptance check');
}

async function assertInsideOwnedTempRoot(directory) {
  const resolved = await realpath(directory);
  const allowedRoot = await realpath(os.tmpdir());
  const relative = path.relative(allowedRoot, resolved);
  assert.notEqual(relative, '', 'the smoke fixture must be a child of the system temp directory');
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'the smoke fixture must remain inside the system temp directory');
  assert.ok(path.basename(resolved).startsWith('demoforge-package-smoke-'), 'the smoke fixture must have its owned marker name');
  return resolved;
}

async function cleanupOwnedTempRoot(directory) {
  if (!directory) return;
  const resolved = await assertInsideOwnedTempRoot(directory);
  const details = await lstat(resolved);
  assert.ok(details.isDirectory() && !details.isSymbolicLink(), 'refusing to remove a fixture path that is not the owned directory');
  await rm(resolved, { recursive: true, force: false });
}

async function assertNoEditorAlert(window) {
  const alert = window.locator('[role="alert"]').first();
  if (await alert.count()) {
    const detail = (await alert.innerText()).trim();
    throw new Error(`The editor reported an error: ${detail || 'unspecified alert.'}`);
  }
  const setupNotice = window.locator('.setup-panel__notice');
  if (await setupNotice.count()) {
    const detail = (await setupNotice.innerText()).trim();
    if (/Chromium is still unavailable/i.test(detail)) throw new Error(`Browser setup did not make Chromium available: ${detail}`);
    if (/setup finished/i.test(detail) && await window.locator('.setup-panel').count()) {
      throw new Error(`Browser setup completed but local requirements are still missing: ${(await window.locator('.setup-panel').innerText()).trim()}`);
    }
  }
}

async function waitFor(window, predicate, description, timeoutMs = stepTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    await assertNoEditorAlert(window);
    try {
      if (await predicate()) {
        await assertNoEditorAlert(window);
        return;
      }
    }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await assertNoEditorAlert(window);
  const detail = lastError instanceof Error ? ` (${lastError.message})` : '';
  throw new Error(`Timed out waiting for ${description}.${detail}`);
}

async function waitForExport(window) {
  await waitFor(window, async () => {
    const notice = window.locator('.message-bar--notice');
    return await notice.count() > 0 && /Exported/.test(await notice.innerText());
  }, `the four-format export to finish after ${operationTimeoutMs} ms`, operationTimeoutMs);
}

async function runStage(name, operation) {
  process.stderr.write(`[package-smoke] START ${name}\n`);
  try {
    const result = await operation();
    process.stderr.write(`[package-smoke] PASS ${name}\n`);
    return result;
  } catch (error) {
    process.stderr.write(`[package-smoke] FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    throw error;
  }
}

async function listFilesRecursively(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await listFilesRecursively(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}

async function runFfmpeg(ffmpegPath, args, options = {}) {
  return execFile(ffmpegPath, args, {
    windowsHide: true,
    timeout: options.timeout ?? 600_000,
    maxBuffer: 8 * 1024 * 1024,
    encoding: options.encoding ?? 'utf8',
  });
}

async function decodeToNull(ffmpegPath, file) {
  await runFfmpeg(ffmpegPath, ['-v', 'error', '-i', file, '-f', 'null', '-']);
}

async function readRawRgb(ffmpegPath, file, crop) {
  const args = ['-v', 'error', '-i', file];
  if (crop) args.push('-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
  args.push('-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-');
  const result = await runFfmpeg(ffmpegPath, args, { encoding: 'buffer' });
  return result.stdout;
}

function maximumChannelValue(pixels) {
  let maximum = 0;
  for (const value of pixels) maximum = Math.max(maximum, value);
  return maximum;
}

async function verifyBlackMask(ffmpegPath, file, label, crop = { x: 300, y: 100, width: 16, height: 16 }) {
  const pixels = await readRawRgb(ffmpegPath, file, crop);
  assert.equal(pixels.length, crop.width * crop.height * 3, `${label} crop should decode to RGB pixels`);
  assert.ok(maximumChannelValue(pixels) <= 24, `${label} should contain the opaque black mask at the reviewed coordinates`);
}

async function verifyCaptionPixels(ffmpegPath, file) {
  const crop = { x: 240, y: 640, width: 800, height: 70 };
  const pixels = await readRawRgb(ffmpegPath, file, crop);
  assert.equal(pixels.length, crop.width * crop.height * 3, 'caption crop should decode to RGB pixels');
  let darkPixels = 0;
  for (let index = 0; index < pixels.length; index += 3) {
    if (pixels[index] <= 80 && pixels[index + 1] <= 80 && pixels[index + 2] <= 80) darkPixels += 1;
  }
  assert.ok(darkPixels >= 32, 'the exported MP4 should render caption outline pixels in the bottom caption band');
}

async function chromiumGeometry(page, url) {
  return page.evaluate((source) => new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const timeout = setTimeout(() => reject(new Error('Timed out decoding the video preview.')), 20_000);
    video.preload = 'auto';
    video.muted = true;
    video.onloadeddata = async () => {
      try {
        if (video.duration > 0) {
          video.currentTime = Math.min(0.5, video.duration / 2);
          await new Promise((ready, failed) => {
            video.onseeked = () => ready(undefined);
            video.onerror = () => failed(new Error('Could not seek the video preview.'));
          });
        }
        clearTimeout(timeout);
        resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    };
    video.onerror = () => { clearTimeout(timeout); reject(new Error('Raw replay preview did not decode.')); };
    video.src = source;
    document.body.append(video);
  }), url);
}

async function patchNativeDialogs(application, routes) {
  await application.evaluate(({ dialog }, allowed) => {
    const calls = { open: 0, saveProject: 0, export: 0 };
    dialog.showOpenDialog = async (...args) => {
      const options = args.at(-1);
      if (!options?.filters?.some((filter) => filter.extensions?.includes('json'))) throw new Error('Smoke harness refused a non-project open dialog.');
      calls.open += 1;
      const selected = calls.open === 1 ? allowed.seedProject : calls.open === 2 ? allowed.savedProject : undefined;
      if (!selected) throw new Error('Smoke harness refused an unexpected open dialog.');
      return { canceled: false, filePaths: [selected] };
    };
    dialog.showSaveDialog = async (...args) => {
      const options = args.at(-1);
      if (options?.title === 'Choose a new export folder') {
        calls.export += 1;
        if (calls.export !== 1) throw new Error('Smoke harness refused an unexpected export dialog.');
        return { canceled: false, filePath: allowed.exportDirectory };
      }
      calls.saveProject += 1;
      if (calls.saveProject !== 1) throw new Error('Smoke harness refused an unexpected project save dialog.');
      return { canceled: false, filePath: allowed.savedProject };
    };
    Object.defineProperty(globalThis, '__demoForgePackageSmokeDialogCalls', { value: calls, configurable: true });
  }, routes);
}

async function setUpWorkflowFixture(fixtureRoot, shopUrl) {
  const source = await readFile(path.join(projectRoot, 'examples', 'shop', 'workflow.demoforge.json'), 'utf8');
  const project = JSON.parse(source);
  project.name = 'Installed package acceptance workflow';
  project.steps[1].name = 'Enter the private customer value';
  delete project.steps[1].value;
  project.steps[1].variable = 'customerName';
  project.steps[0].target = shopUrl;
  project.variables = [{ name: 'customerName', secret: true, description: 'Customer name' }];
  project.edits.masks = [];
  project.edits.annotations = [];

  const seedProject = path.join(fixtureRoot, 'seed-workflow.demoforge.json');
  const savedProject = path.join(fixtureRoot, 'saved-workflow.demoforge.json');
  const exportDirectory = path.join(fixtureRoot, 'synthetic-exports', 'package-smoke');
  await writeFile(seedProject, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  return { project, seedProject, savedProject, exportDirectory };
}

async function installBrowserThroughUi(window) {
  const installButton = window.getByRole('button', { name: 'Install browser', exact: true });
  await waitFor(window, async () => await installButton.count() === 1 && await installButton.isEnabled(), 'the fresh profile to show the first-run browser setup panel', 30_000);
  assert.match(await window.locator('.setup-panel').innerText(), /Chromium/, 'first-run setup should identify the missing Chromium runtime');

  await installButton.click();
  await waitFor(window, async () => {
    const notice = window.locator('.setup-panel__notice');
    const footer = window.locator('.status-footer');
    const controls = [
      window.getByRole('button', { name: 'New', exact: true }),
      window.getByRole('button', { name: 'Open', exact: true }),
      window.getByRole('button', { name: 'Save project', exact: true }),
      window.getByRole('button', { name: 'Replay workflow', exact: true }),
    ];
    return await installButton.isDisabled()
      && /Installing browser/.test(await footer.innerText())
      && /Downloading the local browser runtime/.test(await notice.innerText())
      && (await Promise.all(controls.map((control) => control.isDisabled()))).every(Boolean);
  }, 'the first-run download progress and locked editor controls', 5_000);

  await waitFor(window, async () => {
    const success = window.locator('.setup-success[role="status"]');
    return await success.count() === 1 && /Browser setup finished/.test(await success.innerText());
  }, 'the official browser download and local requirement check', browserSetupTimeoutMs);
}

async function editProjectThroughUi(window, routes) {
  await window.getByRole('button', { name: 'New', exact: true }).click();
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await waitFor(window, async () => (await window.locator('input[aria-label="Project name"]').inputValue()) === 'Installed package acceptance workflow', 'the synthetic project to open');

  const masks = window.locator('details.edit-disclosure').filter({ hasText: 'Opaque privacy masks' });
  await masks.locator('summary').click();
  for (const [label, value] of [
    ['x position (px)', '280'],
    ['y position (px)', '80'],
    ['width (px)', '720'],
    ['height (px)', '580'],
    ['Mask starts (ms)', '0'],
    ['Mask ends (ms)', '60000'],
  ]) await masks.getByLabel(label).fill(value);
  await masks.getByRole('button', { name: 'Add opaque mask', exact: true }).click();
  await waitFor(window, async () => (await masks.locator('.layer-list li').count()) === 1, 'the opaque temporal mask to be added');

  const captions = window.locator('details.edit-disclosure').filter({ hasText: 'Subtitles and annotations' });
  await captions.locator('summary').click();
  await captions.getByLabel('Caption text').fill('Synthetic package acceptance caption');
  await captions.locator('label.field').filter({ hasText: 'Starts (ms)' }).locator('input').fill('0');
  await captions.locator('label.field').filter({ hasText: 'Ends (ms)' }).locator('input').fill('60000');
  await captions.getByRole('button', { name: 'Add subtitle', exact: true }).click();
  await waitFor(window, async () => (await captions.locator('.layer-list li').count()) === 1, 'the synthetic subtitle to be added');

  await window.getByRole('button', { name: 'Save project', exact: true }).click();
  const saved = JSON.parse(await readFile(routes.savedProject, 'utf8'));
  assert.equal(saved.edits.masks.length, 1, 'the saved project should preserve the opaque mask');
  assert.equal(saved.edits.annotations[0]?.text, 'Synthetic package acceptance caption', 'the saved project should preserve the caption');

  await window.getByRole('button', { name: 'New', exact: true }).click();
  await window.getByRole('button', { name: 'Open', exact: true }).click();
  await waitFor(window, async () => (await window.locator('input[aria-label="Project name"]').inputValue()) === saved.name, 'the saved project to reopen');
  const reopenedMaskCount = await window.locator('details.edit-disclosure').filter({ hasText: 'Opaque privacy masks' }).locator('.disclosure-count').innerText();
  assert.equal(reopenedMaskCount, '1', 'reopening the saved project should restore its mask');
}

async function replayAndExport(window, routes, privateValue, ffmpegPath) {
  await window.getByLabel('Customer name', { exact: true }).fill(privateValue);
  await window.getByRole('button', { name: 'Replay workflow', exact: true }).click();
  await waitFor(window, async () => {
    const rows = window.locator('.progress-box .result-list .result-row');
    const status = await window.locator('.progress-box__heading').innerText();
    return (await rows.count()) === 5 && /Passed/.test(status);
  }, 'all five installed-package replay steps to pass', operationTimeoutMs);
  const rows = await window.locator('.progress-box .result-list .result-row').allInnerTexts();
  assert.equal(rows.length, 5, 'the fixture must replay all five workflow steps');
  assert.ok(rows.every((row) => /Passed/.test(row)), 'every fixture step must pass');

  const preview = await window.evaluate(async () => window.demoforge.getPreview());
  assert.match(preview.video ?? '', /^demoforge-media:\/\/capture\//, 'the packaged app should return its constrained replay video URL');
  assert.equal(preview.screenshots.filter(Boolean).length, 5, 'the packaged app should provide a screenshot for each replay step');
  const geometry = await chromiumGeometry(window, preview.video);
  assert.equal(geometry.width, 1280, 'raw replay preview width');
  assert.equal(geometry.height, 720, 'raw replay preview height');
  assert.ok(geometry.duration > 0, 'raw replay preview should have a decodable duration');

  for (const format of ['GIF preview', 'Markdown guide', 'HTML guide']) {
    const input = window.locator('.format-option').filter({ hasText: format }).locator('input[type="checkbox"]');
    await input.check();
  }
  await window.getByRole('checkbox', { name: /I reviewed the recording and/ }).check();
  await window.getByRole('button', { name: 'Export selected formats', exact: true }).click();
  await waitForExport(window);

  const files = await listFilesRecursively(routes.exportDirectory);
  for (const expected of ['demo.mp4', 'demo.gif', 'guide.md', 'guide.html', 'export.json']) {
    assert.ok(files.includes(expected), `the four-format export should contain ${expected}`);
    assert.ok((await stat(path.join(routes.exportDirectory, expected))).size > 0, `${expected} should not be empty`);
  }
  for (const extension of ['.webm', '.run', '.ass']) {
    assert.ok(!files.some((file) => file.toLowerCase().endsWith(extension)), `raw or intermediate ${extension} media should not be published`);
  }
  assert.ok(files.filter((file) => /^images\/step-\d{3}\.png$/.test(file)).length === 5, 'HTML and Markdown guides should include all five masked PNG frames');

  const html = await readFile(path.join(routes.exportDirectory, 'guide.html'), 'utf8');
  const markdown = await readFile(path.join(routes.exportDirectory, 'guide.md'), 'utf8');
  const exportManifest = JSON.parse(await readFile(path.join(routes.exportDirectory, 'export.json'), 'utf8'));
  assert.ok(html.includes('Synthetic package acceptance caption'), 'HTML guide should include the reviewed caption');
  assert.ok(markdown.includes('Synthetic package acceptance caption'), 'Markdown guide should include the reviewed caption');
  assert.ok(html.includes('Runtime variable: customerName'), 'HTML guide should describe the variable without its supplied value');
  assert.ok(markdown.includes('Runtime variable: customerName'), 'Markdown guide should describe the variable without its supplied value');
  assert.ok(!html.includes(privateValue) && !markdown.includes(privateValue), 'text guides must not contain the private runtime value');
  assert.ok(!html.includes('capture.webm') && !markdown.includes('capture.webm'), 'text guides must not reference raw capture media');
  assert.deepEqual(exportManifest.formats.sort(), ['gif', 'html', 'markdown', 'mp4']);
  assert.ok(!files.some((file) => file.toLowerCase().includes('capture')), 'the export folder must not publish raw capture files');

  const pngFrames = files.filter((file) => /^images\/step-\d{3}\.png$/.test(file));
  const markdownFrames = Array.from(markdown.matchAll(/!\[Step \d+\]\((images\/step-\d{3}\.png)\)/g), (match) => match[1]).sort();
  assert.deepEqual(markdownFrames, pngFrames, 'Markdown should reference every masked PNG frame');
  const savedProjectBytes = await readFile(routes.savedProject);
  const canaryBytes = Buffer.from(privateValue, 'utf8');
  assert.equal(savedProjectBytes.indexOf(canaryBytes), -1, 'the saved project must not contain the runtime secret canary');
  for (const file of files) {
    const outputBytes = await readFile(path.join(routes.exportDirectory, ...file.split('/')));
    assert.equal(outputBytes.indexOf(canaryBytes), -1, `${file} must not contain the runtime secret canary`);
  }

  await decodeToNull(ffmpegPath, path.join(routes.exportDirectory, 'demo.mp4'));
  await decodeToNull(ffmpegPath, path.join(routes.exportDirectory, 'demo.gif'));
  await verifyBlackMask(ffmpegPath, path.join(routes.exportDirectory, 'demo.mp4'), 'MP4');
  await verifyBlackMask(ffmpegPath, path.join(routes.exportDirectory, 'demo.gif'), 'GIF');
  await verifyCaptionPixels(ffmpegPath, path.join(routes.exportDirectory, 'demo.mp4'));
  for (const frame of pngFrames) {
    await decodeToNull(ffmpegPath, path.join(routes.exportDirectory, ...frame.split('/')));
    await verifyBlackMask(ffmpegPath, path.join(routes.exportDirectory, ...frame.split('/')), frame);
  }

  return { preview: { width: geometry.width, height: geometry.height }, replayStepCount: rows.length, exportedFiles: files };
}

async function reopenHtmlAndImages(routes, browserExecutable) {
  const browser = await chromium.launch({ executablePath: browserExecutable, headless: true, timeout: 30_000 });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(routes.exportDirectory, 'guide.html')).href, { waitUntil: 'load', timeout: 30_000 });
    assert.equal(await page.locator('h1').innerText(), 'Installed package acceptance workflow');
    const guideImages = page.locator('main img');
    assert.equal(await guideImages.count(), 5, 'reopened HTML guide should show all five PNG frames');
    const htmlFrames = await guideImages.evaluateAll((images) => images.map((image) => image.getAttribute('src')).sort());
    assert.deepEqual(htmlFrames, (await listFilesRecursively(routes.exportDirectory)).filter((file) => /^images\/step-\d{3}\.png$/.test(file)), 'HTML should reference every masked PNG frame');
    await waitFor(page, async () => guideImages.evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth === 1280 && image.naturalHeight === 720)), 'all PNGs in the reopened HTML guide to decode');
    assert.ok((await page.locator('body').innerText()).includes('Synthetic package acceptance caption'));
    const pngFramesDecoded = await guideImages.count();

    await page.goto(pathToFileURL(path.join(routes.exportDirectory, 'demo.gif')).href, { waitUntil: 'load', timeout: 30_000 });
    const gif = page.locator('img');
    await waitFor(page, async () => gif.evaluate((image) => image.complete && image.naturalWidth > 0), 'the exported GIF to reopen in the downloaded Chromium runtime');
    const gifWidth = await gif.evaluate((image) => image.naturalWidth);
    assert.equal(gifWidth, 1280, 'reopened GIF width');
    return { htmlOpened: true, pngFramesDecoded, gifWidth };
  } finally {
    await browser.close();
  }
}

async function runSmoke(options) {
  const { executablePath, ffmpegPath } = await runStage('validate packaged executable and external FFmpeg', async () => {
    if (!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64') throw new Error('Package acceptance supports Windows and Linux x64.');
    if (!path.isAbsolute(options.executable)) throw new Error('Pass the full absolute path to the packaged DemoForge executable.');
    const resolvedExecutable = path.resolve(options.executable);
    if ((process.platform === 'win32' && path.extname(resolvedExecutable).toLowerCase() !== '.exe') || !await isRegularFile(resolvedExecutable)) {
      throw new Error(`Packaged DemoForge executable does not exist as a regular file: ${resolvedExecutable}`);
    }
    const resolvedFfmpeg = await locateFfmpeg(options.ffmpeg);
    await requireFfmpegFeatures(resolvedFfmpeg);
    return { executablePath: resolvedExecutable, ffmpegPath: resolvedFfmpeg };
  });

  const temporaryDirectory = await runStage('create isolated acceptance fixture', () => mkdtemp(path.join(os.tmpdir(), 'demoforge-package-smoke-')));
  const fixtureRoot = await assertInsideOwnedTempRoot(temporaryDirectory);
  const appData = path.join(fixtureRoot, 'app-data');
  const appLocalData = path.join(fixtureRoot, 'app-local-data');
  await Promise.all([mkdir(appData), mkdir(appLocalData)]);
  let server;
  let application;
  try {
    const routes = await runStage('start synthetic localhost shop and prepare project', async () => {
      const { createShop } = await import(pathToFileURL(path.join(projectRoot, 'examples', 'shop', 'server.mjs')).href);
      server = createShop();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      assert.ok(address && typeof address === 'object' && address.port > 0, 'synthetic shop fixture should bind an ephemeral localhost port');
      return setUpWorkflowFixture(fixtureRoot, `http://127.0.0.1:${address.port}/`);
    });
    await access(routes.seedProject);
    assert.ok(!await isRegularFile(routes.savedProject), 'the project save path must be new');
    assert.ok(!await isRegularFile(routes.exportDirectory), 'the export target must be new');

    const environment = Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'));
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.electron_run_as_node;
    environment.DEMOFORGE_FFMPEG = ffmpegPath;
    environment.APPDATA = appData;
    environment.LOCALAPPDATA = appLocalData;
    if (process.platform === 'linux') {
      environment.XDG_CONFIG_HOME = appData;
      environment.XDG_CACHE_HOME = appLocalData;
    }
    let appInfo;
    let window;
    await runStage('launch packaged app and verify its desktop boundary', async () => {
      application = await electron.launch({ executablePath, args: [], env: environment, timeout: 30_000, chromiumSandbox: true });
      appInfo = await application.evaluate(({ app, BrowserWindow }) => ({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        userDataDirectory: app.getPath('userData'),
        noSandboxSwitch: app.commandLine.hasSwitch('no-sandbox'),
        rendererSandbox: BrowserWindow.getAllWindows()[0]?.webContents.getLastWebPreferences().sandbox,
        browserRuntimeDirectory: process.env.PLAYWRIGHT_BROWSERS_PATH,
      }));
      assert.equal(appInfo.isPackaged, true, 'smoke must launch the packaged Electron app');
      assert.ok(path.isAbsolute(appInfo.resourcesPath), 'packaged app should expose its resources directory');
      assert.equal(appInfo.noSandboxSwitch, false, 'the packaged app must not launch Chromium with --no-sandbox');
      assert.equal(appInfo.rendererSandbox, true, 'the editor renderer must have Electron sandboxing enabled');
      assert.equal(appInfo.browserRuntimeDirectory, path.join(appInfo.userDataDirectory, 'browser-runtime'), 'the packaged browser runtime must live under per-user application data');
      window = await application.firstWindow();
      await window.waitForLoadState('domcontentloaded', { timeout: 30_000 });
      await window.getByRole('heading', { name: 'Step sequence' }).waitFor({ state: 'visible', timeout: 30_000 });
      const boundary = await window.evaluate(() => ({ nodeIntegration: typeof window.require, api: Object.keys(window.demoforge ?? {}) }));
      assert.equal(boundary.nodeIntegration, 'undefined', 'the installed editor should keep Node integration disabled');
      assert.ok(boundary.api.includes('openProject') && boundary.api.includes('saveProject') && boundary.api.includes('replay') && boundary.api.includes('getPreview') && boundary.api.includes('export'), 'the installed editor should expose the constrained desktop bridge');
    });

    const runtimeDirectory = appInfo.browserRuntimeDirectory;
    await runStage('complete first-run browser setup in the editor UI', async () => {
      try {
        await installBrowserThroughUi(window);
      } catch (error) {
        try {
          const installLog = await readFile(path.join(runtimeDirectory, 'install.log'), 'utf8');
          if (installLog.trim()) process.stderr.write(`[package-smoke] Browser installer log follows:\n${installLog}\n`);
        } catch (logError) {
          if (logError?.code !== 'ENOENT') throw logError;
        }
        throw error;
      }
    });
    const localChromium = chromium.executablePath();
    const chromiumVersionDirectory = path.basename(path.dirname(path.dirname(localChromium)));
    const chromiumPlatformDirectory = path.basename(path.dirname(localChromium));
    const chromiumExecutable = path.join(runtimeDirectory, chromiumVersionDirectory, chromiumPlatformDirectory, path.basename(localChromium));
    assert.ok(await isRegularFile(chromiumExecutable), 'the downloaded browser runtime executable must exist');

    await runStage('open, edit, save, and reopen the project through the editor', async () => {
      await patchNativeDialogs(application, routes);
      await editProjectThroughUi(window, routes);
    });
    const privateValue = `PRIVATE_PACKAGE_SMOKE_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const evidence = await runStage('replay five steps and verify four masked, secret-safe exports', () => replayAndExport(window, routes, privateValue, ffmpegPath));
    const chromiumEvidence = await runStage('reopen HTML, PNG, and GIF outputs in downloaded Chromium', () => reopenHtmlAndImages(routes, chromiumExecutable));
    const dialogCalls = await application.evaluate(() => globalThis.__demoForgePackageSmokeDialogCalls);
    assert.deepEqual(dialogCalls, { open: 2, saveProject: 1, export: 1 }, 'project and export dialogs must have stayed within the synthetic fixture paths');

    return {
      schemaVersion: 1,
      result: 'passed',
      platform: process.platform,
      appIsPackaged: appInfo.isPackaged,
      chromiumSandbox: { noSandboxSwitch: appInfo.noSandboxSwitch, rendererEnabled: appInfo.rendererSandbox },
      executable: path.basename(executablePath),
      ffmpegExecutable: path.basename(ffmpegPath),
      externalBrowserSetupPassed: true,
      projectRoundTrip: true,
      ...evidence,
      reopened: chromiumEvidence,
      exportDialogCalls: dialogCalls.export,
      rawCapturePublished: false,
      privateVariablePublished: false,
    };
  } finally {
    try {
      if (application) await application.close();
      if (server) {
        server.closeAllConnections?.();
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    } finally {
      await cleanupOwnedTempRoot(fixtureRoot);
    }
  }
}

async function main(args) {
  const options = parseArguments(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const evidence = await runSmoke(options);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Package smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
