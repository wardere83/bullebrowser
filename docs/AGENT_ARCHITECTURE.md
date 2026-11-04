# BulleBrowser agent architecture

The desktop main process owns browser access and injects a typed runtime into the
shared agent. Model reasoning uses Anthropic or OpenAI. Keyless explicit commands
and extractive summaries use a separate rule-based engine; no local reasoning
model is bundled. Local record storage does not prevent model context from being
sent to the selected provider.

## Runtime and source map

| Responsibility | Current source |
| --- | --- |
| Shared agent orchestration, tool dispatch, source sealing | `packages/agent-core/src/agent-loop.ts` |
| OpenAI tool loop | `packages/agent-core/src/openai-loop.ts` |
| Planning and bounded replanning | `packages/agent-core/src/planning.ts` |
| Provider/model definitions | `packages/agent-core/src/types.ts` |
| Keyless command engine | `packages/agent-core/src/local-agent.ts` |
| Privacy decisions and redaction | `packages/agent-core/src/policy.ts` |
| Source containment and instruction detection | `packages/agent-core/src/untrusted.ts` |
| Initial page context | `packages/agent-core/src/retrieval.ts` |
| Session memory | `packages/agent-core/src/memory.ts` |
| Tool schemas and implementations | `packages/agent-core/src/tools/index.ts` |
| Task lifecycle, permissions, persisted events | `apps/desktop/src/main/agent/run.ts` |
| Native browser tool implementation | `apps/desktop/src/main/agent/runtime.ts` |
| Tab ownership, navigation and view layout | `apps/desktop/src/main/tabs/manager.ts` |
| Main/renderer IPC contracts | `apps/desktop/src/shared/ipc.ts` |
| Agent panel and controls | `apps/desktop/src/renderer/components/AiPanel.tsx` |
| Activity, source and replay presentation | `apps/desktop/src/renderer/components/TaskActivity.tsx` |

## Data flow

The renderer submits a user request through the preload IPC bridge. The main
process checks identity and access, constructs source/reference context, and
starts the shared agent with a browser runtime and cancellation signal. The
agent receives observations, plans, executes typed tools, and produces public
progress and answers. Browser mutations retain destination policy and
consequential-action confirmation. Provider-private reasoning is not exported.

Page content, uploaded reference documents and organization passages are data,
not authority. Instruction-like text is scanned before execution; a bounded,
redacted warning identifies its source. All reference text remains sealed even
when no pattern matches. The scanner is a heuristic warning layer, not a complete
prompt-injection defense. Permissions, source containment and tool validation
remain necessary.

## Deployment and validation

Unit contracts exercise mocked model/OS boundaries. Headless Electron tests
exercise the app. Signed updater installation requires platform release checks.
`benchmarks/evaluator/README.md` describes the real-model internal funding suite;
`benchmarks/README.md` describes the separate four-suite release gate. Passing
unit tests is not evidence of real benchmark success.
