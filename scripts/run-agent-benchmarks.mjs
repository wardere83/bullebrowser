import { readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { benchmarkGate, SUITES } from './agent-benchmark-gate.mjs';

/** Adapter commands are administrator configuration, never supplied by pages or models. */
export function configurationErrors(config) {
  const errors = [];
  if (!config || typeof config.baseline !== 'string' || !config.baseline) errors.push('An approved baseline file is required.');
  for (const name of [...SUITES, 'browser-telemetry']) {
    const adapter = config?.adapters?.[name];
    if (!Array.isArray(adapter?.command) || !adapter.command.length || adapter.command.some((arg) => typeof arg !== 'string' || !arg)) {
      errors.push(`${name}: configure an executable and argument array in adapters.${name}.command.`);
    }
    if (adapter?.timeoutMs !== undefined && (!Number.isFinite(adapter.timeoutMs) || adapter.timeoutMs < 1000 || adapter.timeoutMs > 3600000)) errors.push(`${name}: timeoutMs must be between 1000 and 3600000.`);
  }
  return errors;
}

function execute(command, args, cwd, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    // No shell interpolation; adapter output stays in its evidence file, not CI logs.
    const child = spawn(command[0], [...command.slice(1), ...args], { cwd, shell: false, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`Cannot start evaluator: ${error.code ?? 'unknown error'}`)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else reject(new Error(`Evaluator failed (${signal ?? code}); no passing score was produced.`));
    });
  });
}

export async function runBenchmarks({ config, repository, revision, output, preflight = false }) {
  const errors = configurationErrors(config);
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) errors.push('An exact 40-character commit SHA is required.');
  if (errors.length) throw new Error(errors.join('\n'));
  if (!repository || (!preflight && !output)) throw new Error('Repository and output paths are required.');
  if (!preflight) await rm(resolve(output), { force: true });
  const root = resolve(repository);
  const baselinePath = resolve(root, config.baseline);
  await access(baselinePath);
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  for (const name of SUITES) if (!baseline.suites?.[name]) throw new Error(`${name}: approved baseline evidence is missing.`);
  if (preflight) return { configured: true, suites: SUITES, measured: false };
  const destination = resolve(output);
  await mkdir(dirname(destination), { recursive: true });
  const candidate = { revision, suites: {} };
  const times = [];
  // Serial adapters avoid sharing benchmark accounts and contaminating timing measurements.
  for (const name of [...SUITES, 'browser-telemetry']) {
    const evidenceFile = `${destination}.${name}.json`;
    await rm(evidenceFile, { force: true });
    const adapter = config.adapters[name];
    const timeoutMs = Math.min(Math.max(adapter.timeoutMs ?? 1200000, 1000), 3600000);
    await execute(adapter.command, ['--repository', root, '--revision', revision, '--output', evidenceFile], root, timeoutMs);
    const evidence = JSON.parse(await readFile(evidenceFile, 'utf8'));
    if (evidence.revision !== revision) throw new Error(`${name}: evaluator returned a different revision.`);
    const completed = Date.parse(evidence.completedAt);
    if (!Number.isFinite(completed) || completed > Date.now() || Date.now() - completed > 36 * 3600000) {
      throw new Error(`${name}: evidence is stale or has an invalid timestamp.`);
    }
    times.push(completed);
    if (name === 'browser-telemetry') {
      candidate.latency = evidence.latency;
      candidate.actions = evidence.actions;
      candidate.recovery = evidence.recovery;
    } else candidate.suites[name] = evidence.suite;
  }
  // Use the oldest measurement, never relabel stale evidence as freshly measured.
  candidate.completedAt = new Date(Math.min(...times)).toISOString();
  const failures = benchmarkGate(candidate, baseline, { revision });
  await writeFile(destination, JSON.stringify({ ...candidate, validation: { passed: !failures.length, failures } }, null, 2) + '\n');
  if (failures.length) throw new Error(failures.join('\n'));
  return candidate;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
    if (!args.includes('--config')) throw new Error('Missing --config. Configure real suite adapters and an approved baseline; see benchmarks/README.md.');
    const config = JSON.parse(await readFile(value('--config'), 'utf8'));
    await runBenchmarks({ config, repository: value('--repository'), revision: value('--revision'), output: value('--output'), preflight: args.includes('--preflight') });
    console.log(args.includes('--preflight') ? 'Configuration checked; no benchmarks have run.' : 'Measured benchmark evidence passed all release gates.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
