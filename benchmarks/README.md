# Agent browser benchmark execution

The repository owns the runner (`scripts/run-agent-benchmarks.mjs`) and release validator. It does not ship benchmark datasets, model credentials, evaluation accounts, an approved baseline, or human citation audit results. Unit-test fixtures must never be used as release evidence.

## Configuration

Set the GitHub repository variable `AGENT_EVAL_CONFIG` to an administrator-owned JSON object with:

- `baseline`: path to an approved baseline JSON file, absolute or relative to the checkout.
- `adapters`: entries for `webarena`, `visualwebarena`, `mind2web`, `bulle-funding`, and `browser-telemetry`.
- Each adapter has `command`: an executable and argument array, and optional `timeoutMs` (default 20 minutes, maximum 60 minutes).

Commands are run without a shell. They must be installed on the evaluation runner, use pinned datasets/task sets, and evaluate the supplied checkout. Configure runner labels through `AGENT_EVAL_RUNNER` as JSON, for example `["self-hosted","bullebrowser-evals"]`. Without that variable, the workflow uses hosted Ubuntu. The former `AGENT_EVAL_READY` boolean and hard-coded external run script are no longer used. Do not put credentials in repository variables, arguments, or evidence files. Configure credentials on the isolated evaluator through its secret manager. This workflow never runs on pull requests.

## Adapter protocol

Every command receives `--repository PATH --revision SHA --output FILE`. It must exit nonzero on failure and write fresh JSON to FILE on success. Missing output, wrong commit, invalid/future/stale timestamps, and failing thresholds stop publication. Previous adapter files are deleted before execution. Adapter stdout/stderr is not copied to Actions logs, to avoid leaking credentials or raw private task content.

All responses need `revision` and `completedAt` (ISO timestamp). Suite responses need `suite`, containing the fields described in `docs/agentic-browser-upgrade.md`. The telemetry response needs `latency`, `actions`, and `recovery` in the release gate's schema. Funding evidence must incorporate the actual random citation audit. The aggregator preserves the oldest measurement time, validates matching task sets against the baseline, writes the measured candidate and validation failures, and exits nonzero on failure.

Run locally on the configured evaluator:

```sh
node scripts/run-agent-benchmarks.mjs --config /path/to/config.json --repository . --revision EXACT_40_CHARACTER_COMMIT_SHA --output /tmp/candidate.json --preflight
node scripts/run-agent-benchmarks.mjs --config /path/to/config.json --repository . --revision EXACT_40_CHARACTER_COMMIT_SHA --output /tmp/candidate.json
```

Preflight checks configuration and baseline presence only. It does not certify the adapters, authenticate accounts, or claim benchmarks passed. The workflow runs nightly, manually, and during release. Installer builds run concurrently. While `AGENT_EVAL_CONFIG` is unset, no benchmark runs: the workflow succeeds with a "No benchmark evidence" warning, publication proceeds, and nothing records a score or a pass. Once it is set, publication waits for both the installers and measured benchmark validation, and an incomplete configuration, a failing evaluator or a missing result blocks the release.
