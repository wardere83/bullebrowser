# BulleBrowser Architecture

## High-level

BulleBrowser is a desktop browser built on Electron. Its core value is an
**agent loop** wired to the active tab via the Chrome DevTools Protocol
(CDP) so the model can navigate, read, click, type, and extract — like a
person operating the browser, but in a deterministic, auditable loop.

```
┌────────────────────────────────────────────────────────────┐
│                     Renderer (React/TS)                    │
│  Top bar · Tab strip · AI panel · Settings                 │
│        ▲                                                   │
│        │ IPC (typed channels in shared/ipc.ts)             │
│        ▼                                                   │
│                    Main process (Node)                     │
│  Tab manager · WebContentsView host · Agent loop           │
│  Tool registry · CDP executor · Keychain (keytar)          │
│        ▲                          ▲                        │
│        │                          │                        │
│        ▼                          ▼                        │
│   electron-store           Provider API                    │
│   (history, prefs)         (BYOK, streaming, tool use)     │
└────────────────────────────────────────────────────────────┘
```

## Process boundaries

| Process   | Owns                                             |
|-----------|---------------------------------------------------|
| Main      | Window lifecycle, tabs, AI calls, tool execution |
| Preload   | The narrow `window.bullebrowser` IPC surface     |
| Renderer  | All UI; never has Node access                    |

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The
renderer talks to the main process only through the typed bridge defined
in `apps/desktop/src/shared/ipc.ts` and exposed by the preload script.

## Tabs

We use Electron's `WebContentsView` (introduced as the replacement for the
deprecated `BrowserView`). Each tab is one `WebContentsView` attached to
the main `BaseWindow`. The renderer is itself a separate `WebContentsView`
that hosts the React chrome and is laid out around the active tab.

Layout math lives in `main/tabs/layout.ts`. When the AI panel is open the
active tab's bounds shrink horizontally; when a new tab is selected we
just swap `setBounds` on the visible view.

## Agent loop

The current production-safe foundational architecture is documented in
`docs/AGENT_ARCHITECTURE.md`, which describes the modular
perceive -> plan -> act -> verify -> report stack implemented in
`packages/agent-core`.

```
user message ──► Provider.stream({ tools, messages })
                       │
            tool_use blocks?
                ├── no  ──► render to chat, end turn
                └── yes ──► execute via CDP ──► append tool_result ──► repeat
```

Hard limits:

- Max 25 tool calls per task
- Per-tool timeout: 30s (or `wait_for`'s explicit cap of 10s)
- Cancel button drops the in-flight request and clears pending tool
  invocations before the next round

The tool registry lives in `packages/agent-core/src/tools/`. Each tool
exports a Zod input schema, a Zod output schema, and an `execute` function
that receives a typed `ToolContext` (active tab id, CDP session helper,
abort signal). The provider tool-use definitions are derived from the
Zod schemas at startup.

## Storage

| Concern        | Where                                  |
|----------------|-----------------------------------------|
| API keys       | OS keychain via `keytar`                |
| Preferences    | `electron-store` (`config.json`)        |
| History        | `electron-store` (`history.json`)       |
| Bookmarks      | `electron-store` (`bookmarks.json`)     |
| Conversations  | `electron-store` (`conversations.json`) |

Nothing is sent to BulleBrowser servers. There is no telemetry in v1.

## Branding

`packages/brand-tokens` is the single source of truth for colors, type
scale, spacing, and logo paths, consumed by both the desktop app and the
landing page so they stay visually in lockstep.
