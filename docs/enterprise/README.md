# BulleBrowser Enterprise Engineering Library

> Current implementation: local storage and browser control do not imply local model reasoning. Reasoning uses Anthropic or OpenAI and sends relevant context to that provider. Local model adapters in this specification are planned capabilities, not shipped features.

This directory is the implementation source of truth for the enterprise evolution of BulleBrowser. It translates product intent into dependency-aware specifications that Codex and engineering contributors can execute against the current monorepo.

## Current repository baseline

- Desktop application: Electron, React, TypeScript
- Browser control: WebContentsView and Chrome DevTools Protocol
- Agent runtime: `packages/agent-core`
- Web presence: Next.js under `apps/web`
- Backend services: `services/`
- Shared branding: `packages/brand-tokens`
- Security posture: isolated renderer, typed IPC, local storage, BYOK

## Program map

| Status | Volume | Purpose |
|---|---|---|
| Complete | 0. Foundation | Repository assessment, gap analysis, execution strategy |
| Complete | 1. Executive Vision | Mission, positioning, principles, objectives, roadmap |
| In progress | 2. Product Requirements | Requirements, personas, journeys, stories, acceptance criteria, KPIs |
| Planned | 3. Enterprise Architecture | Domain, system, component, data, event, deployment architecture |
| Planned | 4. Identity Platform | Authentication, organizations, RBAC, lifecycle, IdP strategy |
| Planned | 5. AI Platform | Model gateway, routing, orchestration, tools, context, policy |
| Planned | 6. MCP Platform | Runtime, registries, protocol integration, security |
| Planned | 7. Connector Platform | Connector framework, SDK, first-party connectors |
| Planned | 8. Memory Platform | Session memory, persistent memory, retrieval, compression |
| Planned | 9. Collaboration Platform | Workspaces, teams, projects, reviews, activity |
| Planned | 10. Enterprise Administration | Admin, licensing, policy, analytics, audit |
| Planned | 11. Security and Compliance | Threat model, privacy, encryption, recovery, compliance |
| Planned | 12. API Platform | Internal APIs, public APIs, SDKs, events, webhooks |
| Planned | 13. Engineering Handbook | Repository, coding, testing, ADR, documentation standards |
| Planned | 14. DevOps and Release Engineering | CI/CD, packaging, releases, rollback, observability |
| Planned | 15. Codex Playbooks | Ordered implementation plans with verification gates |

## Execution rules

1. Repository reality overrides speculative design.
2. Every requirement must map to an owner, component, and verification method.
3. Security boundaries remain explicit across renderer, preload, main process, services, and external providers.
4. New platform capabilities must be modular and independently testable.
5. No enterprise feature may silently weaken the local-first and user-control guarantees.
6. Implementation work must be delivered through reviewable branches and pull requests.
7. Status changes require evidence: file, test, commit, pull request, or released behavior.

## Active deliverables

- [Volume 2: Product Requirements](./02-product-requirements.md)
- [Codex execution register](./CODEX-EXECUTION-REGISTER.md)

## Definition of done

A volume is complete only when it contains:

- scope and exclusions
- repository-aligned requirements
- dependencies
- security and privacy constraints
- measurable acceptance criteria
- test and validation expectations
- implementation sequencing
- unresolved decisions explicitly recorded
