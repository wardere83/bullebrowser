# BulleBrowser Identity Platform Specification

> Current implementation: local storage and browser control do not imply local model reasoning. Reasoning uses Anthropic or OpenAI and sends relevant context to that provider. Local model adapters in this specification are planned capabilities, not shipped features.

## 1. Purpose

This document defines the implementation contract for adding enterprise identity capabilities to BulleBrowser without breaking the current local-first desktop architecture.

## 2. Current repository constraints

Codex must preserve these existing boundaries:

- Desktop main process owns privileged operations.
- Renderer remains isolated with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Public IPC contracts remain typed through `apps/desktop/src/shared/ipc.ts`.
- Existing local settings and secrets storage remain functional.
- Existing BYOK provider behavior must not regress.

## 3. Target capabilities

### ID-001 Local profile

Add a local user profile containing:

- stable local user ID
- display name
- primary email
- avatar URL or local avatar path
- created timestamp
- updated timestamp

The profile must function without network access.

### ID-002 Organization model

Add organization membership support with:

- organization ID
- organization name
- membership role
- membership status
- created timestamp
- updated timestamp

Supported initial roles:

- owner
- admin
- member
- viewer

### ID-003 Authentication abstraction

Introduce an authentication provider interface that supports:

- local-only mode
- future OAuth providers
- future SAML/OIDC enterprise providers

Do not hard-code a single external identity vendor.

### ID-004 Session model

Add a typed session model containing:

- session ID
- local user ID
- optional organization ID
- authentication mode
- issued timestamp
- expiration timestamp when applicable
- provider metadata

### ID-005 Authorization checks

Add centralized permission evaluation for organization-scoped actions.

Initial permissions:

- organization.read
- organization.manage
- members.read
- members.manage
- settings.read
- settings.manage
- audit.read

## 4. Required repository changes

Codex must inspect the current files before editing, then implement within these locations unless the repository structure has materially changed:

- `apps/desktop/src/main/storage/`
- `apps/desktop/src/main/`
- `apps/desktop/src/preload/`
- `apps/desktop/src/shared/ipc.ts`
- `apps/desktop/src/renderer/state/`
- `apps/desktop/src/renderer/components/`
- `packages/agent-core/src/`

Recommended new files:

- `apps/desktop/src/main/identity/types.ts`
- `apps/desktop/src/main/identity/providers.ts`
- `apps/desktop/src/main/identity/session-service.ts`
- `apps/desktop/src/main/identity/authorization.ts`
- `apps/desktop/src/main/storage/identity.ts`
- `apps/desktop/src/renderer/state/identity-store.ts`

Codex may choose equivalent names only when required by existing conventions.

## 5. Data model requirements

All persisted records must be versioned.

```ts
interface VersionedRecord {
  schemaVersion: number;
}
```

Local identity data must not include provider access tokens in plain-text storage. Provider tokens and refresh tokens must use the existing secure secret-storage mechanism.

## 6. IPC requirements

Expose only narrow, typed operations:

- get current profile
- update current profile
- get current organization
- list memberships
- switch active organization
- evaluate permission
- sign out external session

Never expose raw secret material to the renderer.

## 7. Migration requirements

- Existing users must continue in local-only mode automatically.
- First launch after upgrade must create a local profile lazily.
- Existing settings, history, bookmarks, and conversations must remain readable.
- Migration must be idempotent.

## 8. Error handling

Define typed errors for:

- unauthenticated
- forbidden
- membership not found
- organization not found
- provider unavailable
- invalid session
- migration failure

Errors crossing IPC must be serialized into safe public error objects.

## 9. Acceptance criteria

Identity work is complete only when all conditions pass:

1. Existing local-only desktop startup works with no account configuration.
2. A local profile is created and persisted.
3. Active organization can be selected and restored after restart.
4. Permission checks return deterministic results for all four roles.
5. Renderer never receives secrets.
6. Migration can run repeatedly without data loss.
7. Existing desktop smoke tests still pass.
8. New unit tests cover session creation, role evaluation, organization switching, and migration.

## 10. Validation commands

Codex must run the repository's actual scripts after inspecting `package.json` files. At minimum, execute the available equivalents of:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run desktop smoke tests if supported by the local environment.

## 11. Non-goals

Do not implement in this phase:

- billing
- SCIM provisioning
- production SAML configuration UI
- cloud-hosted identity database
- mandatory sign-in
- removal of local-only mode

## 12. Rollback rule

All identity features must be feature-gated. Disabling the feature must restore current local-only behavior without deleting identity data.
