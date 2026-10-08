#!/usr/bin/env node
import { Command } from 'commander';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadProject, saveProject, parseProject } from './core/project.js';
import { startRecording, replay } from './browser/runner.js';
import { exportRun } from './media/export.js';
import { doctor } from './doctor.js';
import { loadRun } from './core/run.js';
import { validateVariables } from './electron/boundary.js';
import type { RunResult, ExportOptions } from './shared/types.js';

const program = new Command().name('demoforge').description('Record, replay and publish browser demos locally.').version('0.1.0');
program.command('doctor').description('Check local runtime, browser and media encoder.').action(async () => {
  const checks = await doctor(); stdout.write(JSON.stringify(checks, null, 2) + '\n'); if (checks.some(check => !check.ok)) process.exitCode = 1;
});
program.command('record').requiredOption('--url <url>', 'Initial HTTP(S) page').requiredOption('--output <folder>', 'New private local capture folder')
  .description('Open a browser; press Enter in the terminal to stop recording.').action(async options => {
    const url = new URL(options.url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Recording URL must use HTTP(S).');
    const output = path.resolve(options.output); await mkdir(output, { recursive: false });
    stdout.write('Raw recordings may contain sensitive data. Review and mask before sharing.\n');
    const session = await startRecording({ url: url.href, outputDir: output });
    const terminal = createInterface({ input: stdin, output: stdout });
    const stop = () => { void session.cancel(); terminal.close(); };
    process.once('SIGINT', stop);
    try {
      await terminal.question('Perform your workflow in the browser. Press Enter here to finish.\n');
      const { project, run } = await session.stop();
      await saveProject(path.join(output, 'project.demoforge.json'), parseProject(project));
      await writeFile(path.join(output, 'run.json'), JSON.stringify(run, null, 2));
      stdout.write(`Saved ${project.steps.length} steps in ${output}\n`);
    } finally { terminal.close(); process.removeListener('SIGINT', stop); await session.cancel(); }
  });
program.command('replay').argument('<project>', 'Versioned project JSON').requiredOption('--output <folder>', 'New private local run folder')
  .option('--headed', 'Show the replay browser').description('Replay with runtime variables from DEMOFORGE_VAR_<NAME> environment values.').action(async (file, options) => {
    const project = await loadProject(file);
    const variables = Object.fromEntries(project.variables.map(variable => [variable.name, process.env[`DEMOFORGE_VAR_${variable.name}`]]).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const output = path.resolve(options.output); await mkdir(output, { recursive: false });
    const abort = new AbortController(); const cancel = () => abort.abort(); process.once('SIGINT', cancel);
    try {
      const run = await replay(project, { outputDir: output, headless: !options.headed, variables: validateVariables(variables), signal: abort.signal,
        onProgress: step => stdout.write(`${step.status}: ${step.name}\n`) });
      await writeFile(path.join(output, 'run.json'), JSON.stringify(run, null, 2));
      stdout.write(`Run ${run.status}; ${path.join(output, 'run.json')}\n`); if (run.status !== 'passed') process.exitCode = 1;
    } finally { process.removeListener('SIGINT', cancel); }
  });
program.command('export').argument('<project>').requiredOption('--run <file>', 'Local run.json from a successful replay')
  .requiredOption('--output <folder>', 'New sanitized output directory').option('--formats <list>', 'mp4,gif,markdown,html', 'mp4,gif,markdown,html')
  .option('--reviewed', 'Confirm you inspected the recording and masks').description('Create shareable outputs; originals are never automatically included.').action(async (file, options) => {
    const project = await loadProject(file);
    const run = await loadRun(options.run, project);
    const result = await exportRun(project, run, { outputDir: options.output, formats: options.formats.split(',') as ExportOptions['formats'], reviewed: Boolean(options.reviewed) });
    stdout.write(JSON.stringify(result, null, 2) + '\n');
  });
program.parseAsync().catch(error => { console.error(error instanceof Error ? error.message : 'Operation failed.'); process.exitCode = 1; });
