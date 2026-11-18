// Release gate. A desktop release publishes only when, for the exact commit
// being released, the funding evaluator measured the real app and model
// against the funding corpus and passed (90% task success and citation
// accuracy, scored from the sources the agent actually read), and the
// end-to-end suite passed. Both run on main, where the evaluator can reach
// Claude through workload identity federation; the release, built from a
// tag, waits for them here.
//
// A skipped, blocked or still-running evaluation never passes. The evidence
// itself is checked, not only the run's conclusion.

import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REQUIRED = [
  { workflow: 'funding-evaluator.yml', label: 'funding test', evidence: 'funding-evaluator-evidence' },
  { workflow: 'e2e.yml', label: 'end-to-end suite' },
];

/** The newest run of a workflow for the commit, from the API's run list. */
export function latestRun(runs, sha) {
  return runs
    .filter((run) => run.head_sha === sha && run.head_branch === 'main')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

/** 'pass', 'wait' or a reason the gate fails. */
export function runState(run) {
  if (!run) return 'wait';
  if (run.status !== 'completed') return 'wait';
  return run.conclusion === 'success' ? 'pass' : `its run ${run.html_url} ended ${run.conclusion}`;
}

/** Problems with a funding report for this commit; empty when it passes. */
export function reportProblems(report, sha) {
  if (!report || typeof report !== 'object') return ['The funding report is missing.'];
  const problems = [];
  if (report.revision !== sha) problems.push(`The funding report measured ${report.revision}, not ${sha}.`);
  if (report.status !== 'measured') problems.push('The funding report is not a measurement.');
  if (!(report.tasks > 0) || report.tasks !== report.expectedTasks) problems.push('Not every funding task was executed and scored.');
  if (!(report.successRate >= 0.9)) problems.push(`Funding task success was ${report.successRate}, below 0.9.`);
  if (!(report.citationAccuracy >= 0.9)) problems.push(`Funding citation accuracy was ${report.citationAccuracy}, below 0.9.`);
  if (report.validation?.passed !== true) problems.push('The funding report did not pass its own validation.');
  return problems;
}

async function listRuns(api, repository, workflow, sha) {
  const response = await api(`/repos/${repository}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=20`);
  return response.workflow_runs ?? [];
}

export async function gate({ api, download, repository, sha, sleep, now = Date.now, timeoutMs, appearMs, log = console.log }) {
  const started = now();
  const passed = new Set();
  for (;;) {
    for (const required of REQUIRED) {
      if (passed.has(required.workflow)) continue;
      const run = latestRun(await listRuns(api, repository, required.workflow, sha), sha);
      const state = runState(run);
      if (state === 'wait') {
        if (!run && now() - started > appearMs) throw new Error(`No ${required.label} ran on main for ${sha}. Run ${required.workflow} on main for this commit, then publish again.`);
        continue;
      }
      if (state !== 'pass') throw new Error(`The ${required.label} did not pass for ${sha}: ${state}.`);
      if (required.evidence) {
        const problems = reportProblems(await download(run.id, required.evidence), sha);
        if (problems.length) throw new Error(`The ${required.label} evidence does not pass:\n${problems.join('\n')}`);
      }
      passed.add(required.workflow);
      log(`${required.label}: passed (${run.html_url}).`);
    }
    if (passed.size === REQUIRED.length) return;
    if (now() - started > timeoutMs) throw new Error(`Timed out waiting for ${REQUIRED.filter((r) => !passed.has(r.workflow)).map((r) => r.label).join(' and ')} on ${sha}.`);
    await sleep(30_000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GH_TOKEN, REPO, SHA } = process.env;
  const api = async (path) => {
    const response = await fetch(`https://api.github.com${path}`, { headers: { authorization: `Bearer ${GH_TOKEN}`, accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub API ${path} answered ${response.status}.`);
    return response.json();
  };
  const download = async (runId, name) => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-'));
    const result = spawnSync('gh', ['run', 'download', String(runId), '--repo', REPO, '--name', name, '--dir', directory], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Could not download ${name} from run ${runId}.`);
    const file = join(directory, 'funding-report.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  };
  try {
    await gate({
      api, download, repository: REPO, sha: SHA,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      timeoutMs: 70 * 60_000,
      // The evaluator and e2e start with the push that tagged the release.
      appearMs: 15 * 60_000,
    });
    console.log(`Release gate passed for ${SHA}.`);
  } catch (error) {
    console.error(`::error title=Release gate::${String(error.message).replaceAll('\n', '%0A')}`);
    process.exitCode = 1;
  }
}
