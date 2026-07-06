# Contributing to BulleBrowser

Thanks for your interest. BulleBrowser is a proprietary product;
external contributions are accepted on a case-by-case basis.

## Development setup

```bash
pnpm install
pnpm dev          # desktop app
pnpm dev:web      # landing page
```

## Quality gates

Every PR must pass:

- `pnpm typecheck` — TypeScript strict, zero errors
- `pnpm lint`      — ESLint, zero warnings
- `pnpm test`      — Vitest, 80%+ coverage on `packages/agent-core`
- A successful desktop launch: open a tab, navigate, and round-trip one
  message through the AI panel without console errors

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(desktop): add multi-tab drag-to-reorder
fix(agent-core): prevent runaway loop on tool error
docs(release): document notarization secret rotation
```

Allowed scopes: `desktop`, `web`, `agent-core`, `brand-tokens`,
`release`, `docs`, `repo`.

## Branching

Work on a feature branch, open a draft PR early, and request review when
the phase is complete. Squash-merge to `main`.

## Code style

- TypeScript strict mode everywhere
- React function components with hooks (no class components)
- Tailwind for styling; brand tokens come from `@bullebrowser/brand-tokens`
- IPC channel names live in `apps/desktop/src/shared/ipc.ts` — don't
  hardcode strings in the renderer or main process
