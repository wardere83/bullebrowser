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
- Task activity and consent events are persisted with the conversation, inherit its organization visibility and deletion, and expire after 30 days. Expiry is swept when history is read or updated. The upgrade also stores actual post-action JPEG snapshots and recorded cursor positions in that history. Outputs remain bounded (UI excerpts 400 characters, tool-record results 4,000 characters). Snapshots can contain visible page data; the session permission sheet discloses this.
- Audit copies redact credential fields and credential-bearing URLs without changing execution arguments.

- User-authored session scratchpad persists with the organization-scoped conversation, is editable, and has an explicit Forget control. Saved notes apply to every later task in that conversation, until forgotten, as user context, never as verified page evidence.
- View > Stop Task (Command + Shift + Escape on macOS, Shift + Escape on Windows and Linux) cancels running tasks through the existing cancellation path. It is a menu accelerator, so it works while a web page has focus; Windows reserves Ctrl + Shift + Escape for Task Manager. Pause, single step, resume and replan also have native menu accelerators and on-screen controls.
- JSON audit export includes bounded/redacted tool records, consent decisions, sources and call-linked timing. It excludes raw step outputs and private reasoning.
- Page-instruction warning: page-derived text (tool results, search results and the open tab's opening text) is scanned before sealing for text that tries to override the assistant's instructions, addresses AI assistants directly, asks to hide something from the user, or imitates system/tool markup. A `page_instructions` step is emitted once per source per task, with the source and a bounded excerpt. Task activity shows an amber notice outside the collapsible log, and both exports list it. The patterns are deliberately narrow and are a notice, not the defense: every page is sealed as data whether or not anything matches. Uploaded documents and organization reference material are not scanned.

## Release gate and evaluation infrastructure

`scripts/agent-benchmark-gate.mjs` rejects missing/stale/wrong-commit evidence, missing suites, different dataset/task versions, success regressions greater than two percentage points, inadequate funding citation audits, excessive unrecoverable failures, missing remediation samples, missing cursor coverage, and latency misses. Rates are fractions. Its synthetic test inputs are unit-test fixtures, not product benchmark results.

The nightly/reusable `agent-benchmark.yml` workflow invokes the repository-owned `scripts/run-agent-benchmarks.mjs`. It checks administrator-owned adapter configuration, runs each configured evaluator without shell interpolation, rejects stale/wrong-revision/missing output, aggregates the four suite results and browser telemetry, and validates the approved baseline. See `benchmarks/README.md` for configuration and the adapter protocol. There is no hard-coded external run script or readiness toggle.

Installer builds run concurrently with evaluation. Missing `AGENT_EVAL_CONFIG` now fails readiness. Publication requires both builds and actual measured benchmark validation to pass. **Real datasets, evaluation accounts, installed suite adapters, an approved baseline and the random citation audit still need to be supplied.** The runner and validator are available; passing real benchmark results have not been obtained. Contract tests are not product benchmarks.

Evidence JSON has top-level `revision`, `completedAt`, `suites`, `latency`, `actions`, and `recovery`. Each suite needs `datasetRevision`, `taskSetHash`, `tasks` (nonempty and identical to baseline), `successRate`, `hallucinationRate`, `citationAccuracy`, `unrecoverableFailureRate`, `stepsToSuccess`, and `costPerTask`. Funding also needs `auditedCitations` (positive sample count) and `auditMethod` of `random-human-review` or `random-independent-review`. Baseline task sets and dataset versions must match. See the gate for the latency/action/recovery field names and thresholds. Evidence age is capped at 36 hours. Human citation audits and trusted evaluator outputs are still necessary; schema validation alone cannot establish real-world accuracy.

## Additional runtime features

- Upfront session browser permission before any model or browser execution; decline records a failed task with a retry control. Product identity questions do not require browsing. Session authorization does not replace consequential-action consent.
- Separate public goal planner, fast executor and large-model synthesis. Two tool failures on the active goal trigger a fresh plan; replanning is bounded. Goal completion requires a successful observation. The final response requires a fresh page read; this is an observation check, not a semantic correctness guarantee.
- Follow-agent toggle and logical agent tab ownership, native pause/resume/step/replan shortcuts, and a tab rail derived from recorded activity.
- Replay scrubber and playback of captured page states with actual cursor coordinates, links to tool call IDs, and a GIF export. Capture failures are visible; this is sampled replay, not continuous video.
- Initial viewport text is sent to the source panel before full-page/frame extraction finishes. Source links expose recorded excerpts on hover.
- Form field before/after values accompany consequential-action previews. Password values are excluded.

## Outstanding requirements

- Actual public/private benchmark adapters, datasets, accounts, model credentials, approved baseline and random citation audit. No real benchmark score is claimed.
- Measured p95 timing and 300 ms plan streaming, OpenAI streaming, search prewarming and approved domain shortlist.
- OS-level permission integration, permission-sheet timing measurements, and full session scope UI.
- Every-claim passage validation and primary/secondary authority review.
- Complete replay coverage (including frames/background tabs), one-click combined Markdown/GIF export, and replay storage capacity testing.
- Organization memory controls, complete failure-remediation taxonomy, rich-document diffs, and tokens/s/cost telemetry.

## Validation

Run agent-core tests with coverage, desktop unit/native tests, typechecks, lint, desktop build, product-language checks, and `node --test scripts/agent-benchmark-gate.test.mjs`. Browser visual/end-to-end validation requires a working headless browser or virtual display. The previous commit passed GitHub CI, browser end-to-end checks and mobile validation. Local native browser smoke still needs a virtual display; the prior Chromium download returned an invalid archive. No live model evaluation ran without configured credentials.

Follow-up local validation: 1,980 desktop unit tests, 13 native checks, 8 benchmark runner/gate contract tests, desktop typechecks, lint (two existing AttachMenu warnings), production build and product-language checks passed. A new headless scratchpad save/reload/forget test is included for GitHub CI. These checks do not substitute for real benchmark evidence.

Current upgrade validation: 1,984 desktop unit tests plus 13 native checks passed before three additional permission regression tests (all 17 targeted tests passed). Desktop and core typechecks, lint (two existing AttachMenu warnings), production build, and 12 benchmark contract tests passed. GIF bytes were independently decoded with Pillow. Real suite evaluation and new GitHub end-to-end results remain required.
