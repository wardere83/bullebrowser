# BulleBrowser

> The agentic browser for grants, RFPs, and compliance work.

BulleBrowser is a desktop browser by [Bulle Consulting](https://bulleconsulting.com) with a built-in Claude-powered AI agent purpose-built for grants research, RFP comparison, and compliance review workflows. Bring your own Anthropic API key — your prompts go directly to your provider, never to Bulle Consulting.

**Website:** [bullebrowser.com](https://bullebrowser.com)

---

## What it does

The agent operates the active browser tab — same pages, same logins, same data you’d see — through a focused set of actions: navigate, read, click & type, extract, manage tabs, and wait.

### Preset Skills

| Skill | What it does |
|---|---|
| **Grant scanner** | Searches SAM.gov and Grants.gov, follows listings into detail pages, returns a comparison table sorted by deadline with award ceilings and links. |
| **RFP comparator** | Paste 2–4 RFP links. Reads each end to end and returns a side-by-side of deadline, scope, eligibility, contract value, and evaluation criteria. |
| **Compliance review** | Flags clauses against EEO, FERPA, and ADA — plus any checklist items you add — and quotes each clause with its section reference. |

### Control & Trust

- A live “Agent is working” indicator shows each step; a **Stop** button cancels instantly.
- Every task runs on a weighted step budget (default 40): it warns at 75%, stops at the limit, and can be raised per task.
- Form submissions and downloads require explicit confirmation.
- Choose Claude Opus, Sonnet, or Haiku per task.

### Voice

The microphone button dictates a single message. **Voice Mode** starts a live
spoken conversation: hear replies, interrupt by speaking, and ask the assistant
to work in your browser. Both buttons sit on the right of the message composer.
Browser tasks retain their normal progress feed and confirmation controls.

Add an OpenAI API key in Settings to use voice, including when your browser
assistant uses Anthropic. Voice audio goes directly to OpenAI and API usage is
billed to that account. Mute pauses microphone transmission; **Stop Voice Mode**
ends the call, releases the microphone, and stops any voice-started browser task.

### Privacy

- Your prompts go straight to Anthropic — never to Bulle Consulting.
- Your API key is encrypted in your OS keychain.
- History, bookmarks, and conversations stay on your device.
- No analytics. No telemetry.

Full privacy policy: [bullebrowser.com/privacy](https://bullebrowser.com/privacy/)

---

## Site pages

| Page | URL |
|---|---|
| Home | [bullebrowser.com](https://bullebrowser.com/) |
| Features | [bullebrowser.com/features](https://bullebrowser.com/features/) |
| Download | [bullebrowser.com/download](https://bullebrowser.com/download/) |
| Install & Setup | [bullebrowser.com/install](https://bullebrowser.com/install/) |
| About | [bullebrowser.com/about](https://bullebrowser.com/about/) |
| Privacy | [bullebrowser.com/privacy](https://bullebrowser.com/privacy/) |

---

## Repository layout

```
bullebrowser/
├── apps/
│   ├── desktop/          # The BulleBrowser desktop application
│   └── web/              # Landing page (bullebrowser.com)
├── packages/
│   ├── agent-core/       # Tool registry and agent loop
│   └── brand-tokens/     # Shared design tokens (colors, type, logo)
├── docs/
│   ├── ARCHITECTURE.md
│   └── RELEASING.md
└── .github/workflows/    # Build & deploy pipelines
```

---

## Prerequisites

- Node.js 20.11 or newer
- pnpm 9 or newer (`npm install -g pnpm`)

## Getting started

```bash
pnpm install
pnpm dev        # launch the desktop app
pnpm dev:web    # launch the landing page locally
```

## Common scripts

| Script | What it does |
|-----------------------|----------------------------------------|
| `pnpm dev` | Run the desktop app in dev mode |
| `pnpm build` | Build all packages and apps |
| `pnpm package:desktop`| Produce signed installers (CI) |
| `pnpm test` | Run unit tests across the workspace |
| `pnpm lint` | Lint all workspaces |
| `pnpm typecheck` | Type-check all workspaces |

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). All changes use Conventional Commit messages.

## Contact

Press, partnerships, or product feedback: [hello@bulleconsulting.com](mailto:hello@bulleconsulting.com)

## License

BulleBrowser is proprietary software licensed under the terms in [`LICENSE`](./LICENSE). Open source dependencies retain their original licenses; the full list is generated at build time and shown in the in-app About page.
