# Agentic browser upgrade: implementation and release readiness

This branch is a tested foundation for the requested upgrade. It is not evidence that the full top-tier acceptance criteria have been achieved. Do not publish it as an acceptance-complete release.

## Implemented

- The default provider now streams tool blocks. Each complete tool-use block is dispatched immediately through the existing consent, destination and privacy checks. Partial JSON never executes. Results are reused by call ID, so receiving the final model turn cannot repeat an action. Private thinking remains in the provider transcript.
- A shared dispatch queue overlaps only metadata, selection, link and tab-list reads. Navigation, page/ref reads, browser mutations and unknown host tools form barriers. The other provider uses this queue after its buffered response; it does not yet stream.
- The extra 380 ms presentation delay and 550 ms page-reading delay are removed. Actual click/type/select/scroll actions paint their cursor before a 150 ms animation delay. Target refs appear in the overlay. Tool toasts and scroll glow/arrows are driven by actual actions. Reduced-motion handling for the existing cursor is preserved.
- The approved navigation origin is preconnected through Chromium's session. No prefetch or background visit to a speculative destination is introduced.
- Element maps are cached for two seconds per tab, URL and query. Browser mutations and navigation invalidate them; ref fingerprints still resolve targets. Runtime listeners are removed at task completion. Unsolicited DOM changes within the TTL can still require a fresh scan.
- Tool feed events carry call IDs and durations. The UI matches overlapping results by ID and offers opt-in timing.
- Sources distinguish opened/unverified pages from nonempty dispatched page reads. Hover shows the recorded excerpt. Source authority is explicitly unassessed; a `.gov` domain is not automatically labeled primary.
- User-triggered Markdown export includes sources, excerpts, a timeline, public assistant text, and, for archived tasks, consent events and bounded/redacted tool records. No private thinking or invented cursor recording is exported.
- Task activity and consent events are persisted with the conversation, inherit its organization visibility and deletion, and expire after 30 days. Expiry is swept when history is read or updated. This is an activity history, not a visual page-state replay. Outputs remain bounded (UI excerpts 400 characters, tool-record results 4,000 characters); screenshots and full raw pages are not archived.
- Audit copies redact credential fields and credential-bearing URLs without changing execution arguments.

## Release gate and evaluation infrastructure

`scripts/agent-benchmark-gate.mjs` rejects missing/stale/wrong-commit evidence, missing suites, different dataset/task versions, success regressions greater than two percentage points, inadequate funding citation audits, excessive unrecoverable failures, missing remediation samples, missing cursor coverage, and latency misses. Rates are fractions. Its synthetic test inputs are unit-test fixtures, not product benchmark results.

The nightly/reusable `agent-benchmark.yml` workflow expects an existing isolated runner labeled `bullebrowser-evals`. Its trusted administrator-provided `/opt/bullebrowser-evals/run.mjs` must run pinned WebArena, VisualWebArena, Mind2Web and private BulleBrowser funding tasks against the candidate source. It receives `--repository`, `--revision` and `--output`. `/opt/bullebrowser-evals/baseline.json` must contain the approved baseline. No runner, datasets, accounts, credentials, baseline, paid resources or measured scores were provisioned by this change.

Only set repository variable `AGENT_EVAL_READY=true` after that infrastructure is operational. Do not run untrusted pull-request code on this runner. Do not export credentials or full sensitive task traces in benchmark artifacts.

Desktop build/release depends on this evaluation workflow. **Until evaluation is configured, this branch deliberately blocks desktop releases.** Keep the PR in draft until the infrastructure and outstanding product work are ready. A missing evaluator must never be treated as a passing score.

Evidence JSON has top-level `revision`, `completedAt`, `suites`, `latency`, `actions`, and `recovery`. Each suite needs `datasetRevision`, `taskSetHash`, `tasks` (at least 100), `successRate`, `hallucinationRate`, `citationAccuracy`, `unrecoverableFailureRate`, `stepsToSuccess`, and `costPerTask`. Funding also needs `auditedCitations` (at least 100) and `auditMethod: random-human-review`. Baseline task sets and dataset versions must match. See the gate for the latency/action/recovery field names and thresholds. Evidence age is capped at 36 hours. Human citation audits and trusted evaluator outputs are still necessary; schema validation alone cannot establish real-world accuracy.

## Outstanding requirements

- Live p95 measurements, 300 ms public-plan rendering, streaming for the other provider, incremental viewport reads, search prewarming and an approved domain shortlist.
- Native session-start permission handshake and scope chip. Electron permissions are not extension permission bundles; existing site/action confirmations are preserved.
- Follow-agent control, cursor/page-state capture, scrubber, visual replay and GIF export.
- Claim-to-passage citations and authority review; existing citation requirements are unchanged.
- Separate planner/executor orchestration, model routing and self-checks for all task types. Existing recovery and completion tracking remain active.
- Editable session scratchpad and additional organization memory controls. Existing organization knowledge storage remains unchanged.
- Failure-remediation controls across all failure categories, a page-instruction warning banner, form before/after diffs, keyboard pause/step/resume/replan, tab orchestration rail, and full tokens/s telemetry.
- Provisioned public/private evaluation adapters, real benchmark runs, an approved baseline and random citation audit.

## Validation

Run agent-core tests with coverage, desktop unit/native tests, typechecks, lint, desktop build, product-language checks, and `node --test scripts/agent-benchmark-gate.test.mjs`. Browser visual/end-to-end validation requires a working headless browser or virtual display. In this environment neither is available; the Chromium download returned an invalid archive. No live model evaluation ran without configured credentials.
