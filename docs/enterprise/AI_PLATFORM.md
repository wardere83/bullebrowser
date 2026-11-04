# BulleBrowser AI Platform Specification

> Current implementation: local storage and browser control do not imply local model reasoning. Reasoning uses Anthropic or OpenAI and sends relevant context to that provider. Local model adapters in this specification are planned capabilities, not shipped features.

## 1. Purpose

This document defines the implementation contract for evolving the existing BulleBrowser agent stack into a provider-neutral, policy-governed AI platform while preserving current desktop behavior.

## 2. Existing architecture that must remain valid

The current production-safe lifecycle is:

1. perceive
2. plan
3. act
4. verify
5. report

The implementation currently lives in `packages/agent-core` and is injected into the desktop main process. Codex must extend this architecture rather than replace it.

## 3. Required capabilities

### AI-001 Provider gateway

Implement a provider-neutral gateway supporting:

- Anthropic
- OpenAI-compatible providers
- local model adapters
- future managed enterprise endpoints

The gateway must normalize:

- model identifiers
- messages
- tool definitions
- tool calls
- streaming events
- token usage
- provider errors
- stop reasons

### AI-002 Model routing

Add deterministic model routing based on:

- explicit user selection
- task class
- privacy policy
- cost ceiling
- latency preference
- required tool support
- context-window requirement

Routing decisions must be auditable.

### AI-003 Policy gate

Every external model request must pass through the existing policy layer before transmission.

The policy gate must evaluate:

- sensitive content
- organization policy
- provider allowlist
- model allowlist
- external transmission permission
- redaction requirements
- user confirmation requirements

### AI-004 Prompt orchestration

Separate prompt construction into typed layers:

- platform instructions
- organization policy
- skill instructions
- task context
- retrieved context
- tool catalog
- user message

Prompt assembly must be deterministic and testable.

### AI-005 Tool compatibility

Provider adapters must consume the canonical tool registry from `packages/agent-core/src/tools/`.

Do not maintain provider-specific duplicate tool schemas.

### AI-006 Usage accounting

Record per-turn usage when supplied by the provider:

- input tokens
- output tokens
- cached tokens where available
- model
- provider
- latency
- estimated cost
- success or failure

Usage records must exclude secret values and raw sensitive payloads.

### AI-007 Failure handling

Normalize errors into typed categories:

- authentication
- authorization
- rate limit
- timeout
- unavailable
- invalid request
- context overflow
- tool protocol failure
- safety refusal
- unknown provider error

Retry behavior must be explicit, bounded, and idempotency-aware.

## 4. Required repository changes

Codex must inspect the current implementation before editing. Expected areas:

- `packages/agent-core/src/provider.ts`
- `packages/agent-core/src/agent-loop.ts`
- `packages/agent-core/src/planner.ts`
- `packages/agent-core/src/policy.ts`
- `packages/agent-core/src/audit.ts`
- `packages/agent-core/src/types.ts`
- `apps/desktop/src/main/agent/`
- `apps/desktop/src/main/storage/settings.ts`
- `apps/desktop/src/main/storage/secrets.ts`
- `apps/desktop/src/renderer/`

Recommended additions:

- `packages/agent-core/src/providers/types.ts`
- `packages/agent-core/src/providers/gateway.ts`
- `packages/agent-core/src/providers/anthropic.ts`
- `packages/agent-core/src/providers/openai-compatible.ts`
- `packages/agent-core/src/routing/model-router.ts`
- `packages/agent-core/src/prompts/orchestrator.ts`
- `packages/agent-core/src/usage/usage-meter.ts`

## 5. Canonical interfaces

Codex must define stable equivalents of:

```ts
interface AIProviderAdapter {
  id: string;
  listModels(): Promise<ModelDescriptor[]>;
  stream(request: CanonicalModelRequest, signal: AbortSignal): AsyncIterable<CanonicalModelEvent>;
}

interface ModelRouter {
  select(input: RoutingInput): Promise<RoutingDecision>;
}
```

The exact names may change to match repository conventions, but the boundaries must remain.

## 6. Security requirements

- API credentials remain in secure secret storage.
- Renderer must never receive raw credentials.
- Logs must redact credential-like and sensitive fields.
- External transmission must be disabled when policy denies it.
- Provider base URLs must be validated.
- Custom provider endpoints must reject insecure protocols outside local development.

## 7. Backward compatibility

- Existing Anthropic BYOK configuration must continue working.
- Existing model selectors must remain compatible or receive a migration.
- Existing skills must continue using the canonical tool registry.
- Existing audit events must remain readable.
- Existing desktop IPC contracts must not be broken without a versioned migration.

## 8. Acceptance criteria

AI platform work is complete only when:

1. Existing Anthropic workflows still pass.
2. A second provider adapter can complete a text-only turn.
3. A second provider adapter can complete a tool-use turn.
4. Provider errors map to canonical error types.
5. Model routing decisions are deterministic and auditable.
6. Policy denial prevents external transmission.
7. Usage accounting records provider, model, latency, and tokens where available.
8. Cancellation aborts streaming and pending tool execution.
9. No provider credential reaches the renderer or logs.
10. Unit tests cover routing, normalization, redaction, retry bounds, and cancellation.

## 9. Validation commands

Run the actual available repository scripts, including equivalents of:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Additionally run targeted tests for `packages/agent-core` and desktop smoke tests.

## 10. Non-goals

Do not implement in this phase:

- autonomous unbounded agents
- hidden background execution
- provider credential proxying through Bulle Consulting
- removal of local-first behavior
- unrestricted network tool access
- automatic transmission of sensitive page content

## 11. Rollback

Provider-neutral functionality must be feature-gated. Disabling the feature must return the app to the current Anthropic-compatible path without altering existing keys or conversations.
