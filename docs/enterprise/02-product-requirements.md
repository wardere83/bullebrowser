# Volume 2: Product Requirements

> Current implementation: local storage and browser control do not imply local model reasoning. Reasoning uses Anthropic or OpenAI and sends relevant context to that provider. Local model adapters in this specification are planned capabilities, not shipped features.

## 1. Objective

Evolve BulleBrowser into a secure enterprise work platform while preserving the existing Electron desktop shell, React/TypeScript renderer, typed preload and IPC boundary, `WebContentsView` tab runtime, Chrome DevTools Protocol browser control, BYOK model access, and modular agent architecture in `packages/agent-core`.

## 2. Repository baseline

Codex must treat these existing components as the implementation baseline:

- `apps/desktop`: Electron desktop application
- `apps/web`: Next.js public website
- `packages/agent-core`: perceive, plan, act, verify, report runtime
- `packages/brand-tokens`: shared visual tokens
- `services/widget-backend`: backend service surface
- `docs/ARCHITECTURE.md`: process and browser architecture
- `docs/AGENT_ARCHITECTURE.md`: current agent modules and safety defaults

Existing invariants that must not regress:

- `contextIsolation: true`
- `nodeIntegration: false`
- sandboxed renderer
- secrets outside renderer state
- typed IPC boundary
- local-first operation
- explicit confirmation for sensitive actions
- compatibility with existing skills and model selection

## 3. Product principles

1. User control before autonomy.
2. Local-first by default.
3. Explicit approval for consequential actions.
4. Provider-neutral AI architecture.
5. Evidence-linked and auditable execution.
6. Least privilege across users, processes, tools, connectors, and services.
7. Versioned extension contracts.
8. Enterprise capability must not degrade personal desktop use.

## 4. Scope

### In scope

- personal and organization workspaces
- identity, teams, RBAC, and policy
- provider-neutral model gateway
- governed agent execution
- MCP-compatible tools and resources
- connector framework and SDK
- session and persistent memory
- projects, comments, reviews, and approvals
- administration, licensing, analytics, and audit
- internal APIs, public APIs, events, and webhooks
- CI/CD, release, rollback, and observability

### Initial exclusions

- autonomous financial transactions
- silent regulated-form submissions
- credential harvesting or access-control bypass
- unrestricted remote browser control
- plaintext secret storage
- cloud synchronization without explicit policy and user notice

## 5. Personas

- **Independent consultant:** private grant, RFP, research, and compliance workflows.
- **Program manager:** projects, deadlines, artifacts, reviews, and evidence trails.
- **Compliance reviewer:** source-linked findings, version history, and approval gates.
- **Organization administrator:** users, roles, providers, connectors, retention, audit, and licensing.
- **Security administrator:** identity, secrets, logging, residency, and incident controls.
- **Developer:** tools, skills, connectors, MCP servers, SDKs, and fixtures.

## 6. Business requirements

| ID | Requirement | Priority |
|---|---|---|
| BR-001 | Preserve the current personal desktop experience. | Must |
| BR-002 | Support governed organization workspaces and tenant isolation. | Must |
| BR-003 | Provide auditable AI browser execution for grants, RFP, procurement, compliance, and research. | Must |
| BR-004 | Support multiple model providers through a neutral gateway. | Must |
| BR-005 | Support versioned tools, skills, connectors, and MCP integrations. | Must |
| BR-006 | Require explicit approval for consequential actions. | Must |
| BR-007 | Produce evidence-linked outputs and execution history. | Must |
| BR-008 | Support projects, review, comments, and approvals. | Should |
| BR-009 | Provide centralized administration, policy, audit, and licensing. | Must |
| BR-010 | Preserve useful local operation during enterprise-service outages. | Must |

## 7. Functional requirements

### Organization and identity

- FR-ORG-001: Support personal and organization workspaces.
- FR-ORG-002: Allow one user to belong to multiple organizations.
- FR-ORG-003: Make active organization context explicit in UI and execution context.
- FR-ORG-004: Enforce tenant isolation in service authorization and storage.
- FR-ID-001: Support Google Workspace federation in the first enterprise phase.
- FR-ID-002: Keep identity contracts compatible with future OIDC and SAML providers.
- FR-ID-003: Enforce RBAC in services, not only in renderer state.
- FR-ID-004: Support session revocation, membership deactivation, and auditable identity changes.

### AI and agent runtime

- FR-AI-001: Preserve Anthropic BYOK support.
- FR-AI-002: Add a provider-neutral model gateway behind `packages/agent-core` provider interfaces.
- FR-AI-003: Support organization allowlists for providers and models.
- FR-AI-004: Record provider, model, policy, latency, and usage metadata without secrets.
- FR-AG-001: Preserve the perceive, plan, act, verify, report lifecycle.
- FR-AG-002: Enforce action, token, time, retry, and task budgets.
- FR-AG-003: Classify tools as read, write, external side effect, or high risk.
- FR-AG-004: Apply approval policy before execution.
- FR-AG-005: Propagate cancellation through model, tool, connector, and browser operations.
- FR-AG-006: Emit structured execution events and evidence references.

### Browser control

- FR-BR-001: Continue using isolated `WebContentsView` browser tabs.
- FR-BR-002: Scope every tool call to an authorized task and tab.
- FR-BR-003: Keep Node APIs and secrets outside renderer access.
- FR-BR-004: Require confirmation for downloads, submissions, destructive changes, and external communications.
- FR-BR-005: Show current action, approval state, and stop control.

### MCP, tools, and connectors

- FR-MCP-001: Add MCP support behind an adapter boundary.
- FR-MCP-002: Require schema, provenance, version, permissions, and risk class for every tool.
- FR-MCP-003: Allow organization policy to disable tools and MCP servers.
- FR-MCP-004: Isolate MCP failures from the core agent runtime.
- FR-CON-001: Provide a connector registry and shared lifecycle.
- FR-CON-002: Support authorization, scope display, secret storage, health checks, revocation, and audit.
- FR-CON-003: Prioritize Google Workspace and GitHub as first-party enterprise connectors.
- FR-CON-004: Route connector actions through the same policy and approval engine as browser tools.
- FR-CON-005: Publish versioned connector SDK contracts and test fixtures.

### Memory and collaboration

- FR-MEM-001: Separate task context, session memory, user memory, and organization knowledge.
- FR-MEM-002: Support inspection and deletion according to authority.
- FR-MEM-003: Record source, scope, version, and access controls for organization knowledge.
- FR-MEM-004: Apply tenant and user authorization before retrieval ranking.
- FR-COL-001: Support projects containing tasks, artifacts, sources, comments, and reviews.
- FR-COL-002: Support reviewer assignment and approval state.
- FR-COL-003: Preserve version history for agent-generated and human-edited artifacts.
- FR-COL-004: Prevent organization collaboration from exposing personal-workspace content.

### Administration, APIs, and events

- FR-ADM-001: Manage organizations, members, roles, policies, providers, connectors, retention, and licenses.
- FR-ADM-002: Create append-oriented audit events for security-sensitive and consequential actions.
- FR-ADM-003: Support authorized audit search and export.
- FR-API-001: Define versioned internal service APIs.
- FR-API-002: Introduce public APIs only after tenancy, authorization, quota, audit, and versioning controls exist.
- FR-API-003: Publish domain events for agent runs, approvals, projects, connectors, and audit.
- FR-API-004: Sign outbound webhooks and enforce replay protection and idempotency.

## 8. Non-functional requirements

### Security and privacy

- NFR-SEC-001: Preserve the existing Electron isolation settings.
- NFR-SEC-002: Never persist secrets in plaintext or expose them through renderer state.
- NFR-SEC-003: Apply least privilege to identities, processes, tools, connectors, and services.
- NFR-SEC-004: Record structured audit events for security-sensitive operations.
- NFR-PRI-001: Keep personal-workspace content local by default.
- NFR-PRI-002: Require explicit configuration and disclosure for cloud synchronization.
- NFR-PRI-003: Do not collect page content, prompts, secrets, or artifacts through telemetry by default.

### Reliability and performance

- NFR-REL-001: Return bounded, actionable errors for failed agent operations.
- NFR-REL-002: Cancellation must stop future side effects.
- NFR-REL-003: Retryable writes must be idempotent or duplicate-protected.
- NFR-REL-004: Enterprise-service outages must not corrupt local state.
- NFR-PERF-001: Desktop startup and basic browsing must not depend on enterprise services.
- NFR-PERF-002: Agent status must become visible within one second of task acceptance.
- NFR-PERF-003: Renderer interaction must remain responsive during streaming and tool execution.

### Maintainability and accessibility

- NFR-MNT-001: Keep core domain types provider-neutral.
- NFR-MNT-002: Require typed interfaces, tests, and ownership documentation for new modules.
- NFR-MNT-003: Require ADRs for changes to process, security, data, or service boundaries.
- NFR-ACC-001: All new interfaces must be keyboard-operable and expose accessible names and states.

## 9. Codex implementation rules

Codex must:

1. inspect existing files before creating or modifying modules;
2. reuse existing types and patterns where compatible;
3. avoid renaming public IPC channels without a migration plan;
4. avoid replacing the current agent loop with a parallel implementation;
5. add interfaces before provider-specific implementations;
6. keep enterprise features behind explicit configuration or feature flags until verified;
7. add unit, integration, and end-to-end tests for each new capability;
8. run repository validation before marking work complete;
9. document unresolved decisions rather than inventing hidden assumptions;
10. keep each pull request limited to one coherent implementation slice.

## 10. Required validation commands

Codex must run the applicable repository commands after each implementation slice:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Desktop behavior changes must also run the existing desktop end-to-end suite. Packaging or release changes must execute the applicable packaging workflow in a non-production test context.

## 11. Acceptance gates

Volume 2 is complete when:

- every requirement has a stable identifier;
- requirements do not contradict existing architecture invariants;
- enterprise capabilities are separable from personal local-first use;
- identity, policy, audit, and tenancy precede collaborative cloud features;
- consequential actions remain approval-gated;
- implementation rules and validation commands are explicit;
- downstream architecture and playbooks can trace implementation work to these requirement IDs.

## 12. Dependency order

1. shared domain contracts and feature flags
2. identity, organization, tenancy, and RBAC
3. policy, approval, and audit foundations
4. provider-neutral model gateway
5. MCP and connector contracts
6. memory and retrieval boundaries
7. projects, collaboration, and review
8. administration and licensing
9. public APIs and webhooks
10. production hardening and release gates

## 13. Open decisions

These decisions must be resolved through ADRs before implementation:

- local-only versus hosted enterprise control plane
- organization data residency model
- identity provider and session technology
- database and tenant-isolation strategy
- event transport and audit retention design
- licensing enforcement boundary
- supported model providers for the first enterprise release
