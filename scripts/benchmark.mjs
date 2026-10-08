import { createServer } from 'node:http';
import { cpus, arch, platform, release, tmpdir } from 'node:os';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { replay } from '../dist/browser/runner.js';
import { createProject } from '../dist/core/project.js';
import { exportRun } from '../dist/media/export.js';

const viewport = { width: 1280, height: 720 };
const stepPauseMs = 80;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Northstar Supply | Synthetic Store</title>
<style>
  *{box-sizing:border-box}body{margin:0;background:#f3f5f8;color:#192533;font:16px system-ui,sans-serif}
  header{padding:22px 48px;background:#17324d;color:white;display:flex;justify-content:space-between}
  main{max-width:1100px;margin:30px auto;padding:0 24px}.panel{background:white;border:1px solid #d8e0e8;border-radius:12px;padding:24px;margin:18px 0}
  h1{font-size:28px;margin:0 0 16px}h2{font-size:20px;margin-top:0}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
  label{display:block;font-size:13px;color:#526477;margin:12px 0 5px}input,select{width:100%;padding:11px;border:1px solid #b9c7d4;border-radius:6px;font:inherit}
  button{border:0;border-radius:6px;padding:11px 16px;background:#166c78;color:white;font:inherit;cursor:pointer;margin:8px 8px 0 0}
  .product{padding:16px;background:#f7fafc;border-radius:8px}.status{min-height:24px;color:#12616a;font-weight:600}.muted{color:#647789}
</style></head><body>
<header><strong>Northstar Supply</strong><span>Tools for everyday projects</span><span>Cart <b id="cart-count">0</b></span></header>
<main>
  <h1>Checkout a local order</h1>
  <section class="panel" id="search-panel"><h2>Find products</h2>
    <label for="search">Search catalog</label><input id="search" data-testid="search" value="">
    <button id="search-submit" data-testid="search-submit">Search</button><p class="status" id="search-status">Catalog ready</p>
    <div class="grid" id="product-results"><div class="product">Starter toolkit · $48 <button id="add-starter" data-testid="add-starter">Add toolkit</button></div>
    <div class="product">Field guide · $16 <button id="add-field-guide" data-testid="add-field-guide">Add guide</button></div></div>
    <button id="open-cart" data-testid="open-cart">Review cart</button>
  </section>
  <section class="panel"><h2>Delivery details</h2><div class="grid">
    <div><label for="customer-name">Name</label><input id="customer-name"></div>
    <div><label for="customer-email">Email</label><input id="customer-email"></div>
    <div><label for="shipping-address">Shipping address</label><input id="shipping-address"></div>
    <div><label for="shipping-method">Delivery speed</label><select id="shipping-method"><option value="standard">Standard</option><option value="express">Express</option></select></div>
  </div><label for="order-note">Order note</label><input id="order-note"></section>
  <section class="panel" id="cart-panel"><h2>Cart and payment</h2><p class="status" id="cart-status">Cart is ready</p>
    <button id="continue-payment" data-testid="continue-payment">Continue to payment</button><p class="status" id="payment-status">Payment details are ready</p>
    <div class="grid"><div><label for="card-name">Cardholder</label><input id="card-name"></div>
    <div><label for="card-number">Test card number</label><input id="card-number"></div>
    <div><label for="card-expiry">Expiry</label><input id="card-expiry"></div>
    <div><label for="card-cvc">Security code</label><input id="card-cvc"></div></div>
    <button id="place-order" data-testid="place-order">Place synthetic order</button>
    <p class="status" id="confirmation-status">No order placed</p>
    <button id="print-receipt" data-testid="print-receipt">Prepare receipt</button><p class="status" id="receipt-status">Receipt pending</p>
    <button id="new-order" data-testid="new-order">Start another order</button>
  </section>
</main>
<script>
  let items = 0;
  document.querySelector('#search-submit').addEventListener('click', () => { document.querySelector('#search-status').textContent = '2 matching products'; });
  for (const id of ['add-starter','add-field-guide']) document.querySelector('#'+id).addEventListener('click', () => { document.querySelector('#cart-count').textContent = String(++items); });
  document.querySelector('#open-cart').addEventListener('click', () => { document.querySelector('#cart-status').textContent = items + ' items in cart'; });
  document.querySelector('#continue-payment').addEventListener('click', () => { document.querySelector('#payment-status').textContent = 'Payment section opened'; });
  document.querySelector('#place-order').addEventListener('click', () => { document.querySelector('#confirmation-status').textContent = 'Synthetic order NS-2048 confirmed'; });
  document.querySelector('#print-receipt').addEventListener('click', () => { document.querySelector('#receipt-status').textContent = 'Receipt prepared locally'; });
  document.querySelector('#new-order').addEventListener('click', () => { document.querySelector('#search-status').textContent = 'Ready for another order'; });
</script></body></html>`;

function shopProject(url) {
  const project = createProject('Northstar Supply synthetic checkout');
  project.viewport = viewport;
  const step = (id, name, action, target, value) => ({
    id,
    name,
    action,
    ...(target ? { target } : {}),
    ...(value !== undefined ? { value } : {}),
    timeoutMs: 5_000,
    pauseMs: action === 'wait' ? 0 : stepPauseMs,
  });
  project.steps = [
    step('open-store', 'Open the local storefront', 'navigate', url),
    step('search-catalog', 'Search the catalog', 'fill', '#search', 'weekend project kit'),
    step('submit-search', 'Show matching products', 'click', '#search-submit'),
    step('wait-search', 'Wait for search results', 'wait', '#product-results'),
    step('add-toolkit', 'Add the toolkit', 'click', '#add-starter'),
    step('add-guide', 'Add the field guide', 'click', '#add-field-guide'),
    step('open-cart', 'Review the cart', 'click', '#open-cart'),
    step('wait-cart', 'Wait for cart summary', 'wait', '#cart-status'),
    step('customer-name', 'Enter customer name', 'fill', '#customer-name', 'Taylor Example'),
    step('customer-email', 'Enter customer email', 'fill', '#customer-email', 'taylor@example.test'),
    step('delivery-address', 'Enter delivery address', 'fill', '#shipping-address', '42 Sample Street'),
    step('delivery-speed', 'Choose delivery speed', 'select', '#shipping-method', 'express'),
    step('order-note', 'Add an order note', 'fill', '#order-note', 'Synthetic benchmark order'),
    step('continue-payment', 'Continue to payment', 'click', '#continue-payment'),
    step('wait-payment', 'Wait for payment details', 'wait', '#payment-status'),
    step('cardholder', 'Enter cardholder', 'fill', '#card-name', 'Taylor Example'),
    step('card-number', 'Enter synthetic test card', 'fill', '#card-number', '4242424242424242'),
    step('card-expiry', 'Enter test expiry', 'fill', '#card-expiry', '12/30'),
    step('card-cvc', 'Enter synthetic security code', 'fill', '#card-cvc', '123'),
    step('place-order', 'Place the synthetic order', 'click', '#place-order'),
    step('wait-confirmation', 'Wait for order confirmation', 'wait', '#confirmation-status'),
    step('prepare-receipt', 'Prepare a local receipt', 'click', '#print-receipt'),
    step('wait-receipt', 'Wait for receipt status', 'wait', '#receipt-status'),
    step('new-order', 'Return to the storefront', 'click', '#new-order'),
    step('wait-ready', 'Wait for the next order', 'wait', '#search-panel'),
  ];
  return project;
}

function startRssSampler(intervalMs = 20) {
  let peakRssBytes = process.memoryUsage.rss();
  const timer = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
    return peakRssBytes;
  };
}

async function measure(operation) {
  const stopSampling = startRssSampler();
  const started = performance.now();
  try {
    const value = await operation();
    return {
      value,
      wallClockMs: Math.round((performance.now() - started) * 10) / 10,
      sampledPeakRssBytes: stopSampling(),
    };
  } catch (error) {
    stopSampling();
    throw error;
  }
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolutePath, relativePath));
    else if (entry.isFile()) files.push({ path: relativePath, bytes: (await stat(absolutePath)).size });
  }
  return files;
}

function sumBytes(files) {
  return files.reduce((total, file) => total + file.bytes, 0);
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local benchmark server did not bind a TCP port.');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'demoforge-benchmark-'));
  const captureDir = path.join(root, 'capture');
  const exportDir = path.join(root, 'export');
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  try {
    const url = await listen(server);
    const project = shopProject(url);
    const capture = await measure(() => replay(project, { outputDir: captureDir, headless: true }));
    const run = capture.value;
    if (run.status !== 'passed') {
      const failures = run.steps.filter((step) => step.status !== 'passed').map(({ id, status, error }) => ({ id, status, error }));
      throw new Error(`Synthetic browser capture failed: ${JSON.stringify(failures)}`);
    }
    const exported = await measure(() => exportRun(project, run, {
      outputDir: exportDir,
      formats: ['mp4', 'gif', 'markdown', 'html'],
      reviewed: true,
    }));
    const captureFiles = await listFiles(captureDir);
    const exportFiles = await listFiles(exportDir);
    const cpu = cpus()[0];
    const outputPath = path.resolve(process.env.DEMOFORGE_BENCHMARK_OUTPUT ?? 'artifacts/performance-benchmark.json');
    const result = {
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      scope: 'One local synthetic browser replay and one local FFmpeg export; timings are this host run only.',
      environment: {
        nodeVersion: process.version,
        platform: platform(),
        osRelease: release(),
        architecture: arch(),
        cpuModel: cpu?.model ?? 'unknown',
        logicalCpuCount: cpus().length,
        ffmpegSource: process.env.DEMOFORGE_FFMPEG ? 'DEMOFORGE_FFMPEG environment variable' : 'PATH lookup',
      },
      workflow: {
        name: project.name,
        steps: project.steps.length,
        viewport,
        pauseBetweenActionsMs: stepPauseMs,
        inputDurationMs: run.durationMs,
        runStatus: run.status,
      },
      capture: {
        wallClockMs: capture.wallClockMs,
        sampledPeakRssBytes: capture.sampledPeakRssBytes,
        videoBytes: run.video ? (await stat(run.video)).size : null,
        screenshotCount: run.steps.filter((step) => step.screenshot).length,
        outputBytes: sumBytes(captureFiles),
        files: captureFiles,
      },
      export: {
        wallClockMs: exported.wallClockMs,
        sampledPeakRssBytes: exported.sampledPeakRssBytes,
        outputBytes: sumBytes(exportFiles),
        files: exportFiles,
        formats: ['mp4', 'gif', 'markdown', 'html'],
      },
      memoryScope: 'Sampled process.memoryUsage().rss for this Node process at 20 ms intervals. Spawned Chromium and FFmpeg process memory is excluded.',
    };
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ output: outputPath, ...result }, null, 2)}\n`);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
