# Agentic browser upgrade: implementation and release readiness

This upgrade is a tested foundation for the requested work. It is not evidence that the full top-tier acceptance criteria have been achieved, and release notes must not describe it as acceptance-complete or cite benchmark scores.

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

- User-authored session scratchpad persists with the organization-scoped conversation, is editable, and has an explicit Forget control. Saved notes apply to every later task in that conversation, until forgotten, as user context, never as verified page evidence.
- View > Stop Task (Command + Shift + Escape on macOS, Shift + Escape on Windows and Linux) cancels running tasks through the existing cancellation path. It is a menu accelerator, so it works while a web page has focus; Windows reserves Ctrl + Shift + Escape for Task Manager. Pause/step/resume/replan are still outstanding.
- JSON audit export includes bounded/redacted tool records, consent decisions, sources and call-linked timing. It excludes raw step outputs and private reasoning.

## Release gate and evaluation infrastructure

`scripts/agent-benchmark-gate.mjs` rejects missing/stale/wrong-commit evidence, missing suites, different dataset/task versions, success regressions greater than two percentage points, inadequate funding citation audits, excessive unrecoverable failures, missing remediation samples, missing cursor coverage, and latency misses. Rates are fractions. Its synthetic test inputs are unit-test fixtures, not product benchmark results.

The nightly/reusable `agent-benchmark.yml` workflow invokes the repository-owned `scripts/run-agent-benchmarks.mjs`. It checks administrator-owned adapter configuration, runs each configured evaluator without shell interpolation, rejects stale/wrong-revision/missing output, aggregates the four suite results and browser telemetry, and validates the approved baseline. See `benchmarks/README.md` for configuration and the adapter protocol. There is no hard-coded external run script or readiness toggle.

Installer builds run concurrently with evaluation. While the repository variable `AGENT_EVAL_CONFIG` is unset, no benchmark runs and publication is not gated on one; the workflow reports "No benchmark evidence" and records no score. Once it is set, publication waits for both jobs to pass. **Real datasets, evaluation accounts, installed suite adapters, an approved baseline and the random citation audit still need to be supplied.** The runner and validator are available; passing real benchmark results have not been obtained. Contract tests are not product benchmarks.

Evidence JSON has top-level `revision`, `completedAt`, `suites`, `latency`, `actions`, and `recovery`. Each suite needs `datasetRevision`, `taskSetHash`, `tasks` (nonempty and identical to baseline), `successRate`, `hallucinationRate`, `citationAccuracy`, `unrecoverableFailureRate`, `stepsToSuccess`, and `costPerTask`. Funding also needs `auditedCitations` (positive sample count) and `auditMethod` of `random-human-review` or `random-independent-review`. Baseline task sets and dataset versions must match. See the gate for the latency/action/recovery field names and thresholds. Evidence age is capped at 36 hours. Human citation audits and trusted evaluator outputs are still necessary; schema validation alone cannot establish real-world accuracy.

## Outstanding requirements

- Live p95 measurements, 300 ms public-plan rendering, streaming for the other provider, incremental viewport reads, search prewarming and an approved domain shortlist.
- Native session-start permission handshake and scope chip. Electron permissions are not extension permission bundles; existing site/action confirmations are preserved.
- Follow-agent control, cursor/page-state capture, scrubber, visual replay and GIF export.
- Claim-to-passage citations and authority review; existing citation requirements are unchanged.
- Separate planner/executor orchestration, model routing and self-checks for all task types. Existing recovery and completion tracking remain active.
- Additional organization memory controls. Existing organization knowledge storage remains unchanged.
- Failure-remediation controls across all failure categories, a page-instruction warning banner, form before/after diffs, keyboard pause/step/resume/replan, tab orchestration rail, and full tokens/s telemetry.
- Provisioned public/private evaluation adapters, real benchmark runs, an approved baseline and random citation audit.

## Validation

Run agent-core tests with coverage, desktop unit/native tests, typechecks, lint, desktop build, product-language checks, and `node --test scripts/agent-benchmark-gate.test.mjs`. Browser visual/end-to-end validation requires a working headless browser or virtual display. The previous commit passed GitHub CI, browser end-to-end checks and mobile validation. Local native browser smoke still needs a virtual display; the prior Chromium download returned an invalid archive. No live model evaluation ran without configured credentials.

Follow-up local validation: 1,980 desktop unit tests, 13 native checks, 8 benchmark runner/gate contract tests, desktop typechecks, lint (two existing AttachMenu warnings), production build and product-language checks passed. A new headless scratchpad save/reload/forget test is included for GitHub CI. These checks do not substitute for real benchmark evidence.
