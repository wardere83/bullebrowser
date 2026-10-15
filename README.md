# BulleBrowser

> Strategic funding for businesses and CBOs.

BulleBrowser is a desktop browser by [Bulle Consulting](https://bulleconsulting.com) that connects official funding opportunities with your organization’s mission, priorities and documented strengths.

**Website:** [bullebrowser.com](https://bullebrowser.com)

## Visible browser research

Blank tabs show the shared product video introduction. The browser stays on the left and Your Assistant on the right, with four browsing options:

- **Find grants for me** — explore relevant funding sources for your location and goal.
- **Research a funder** — read the funder’s own priorities and guidance.
- **Compare grant opportunities** — inspect sources across retained tabs.
- **Explore this page** — investigate the page you are viewing.

Selecting an option asks one short clarifying question. Answer to start browsing, or type your request directly. Follow the visible cursor, navigation and reading activity; use Stop to interrupt. Basic source discovery works without a provider key. Connect your own AI provider in Settings for model-powered research and analysis. Relevant page content, conversation history and attachments may be sent directly to that provider.

The marketing site and desktop introduction share a generated, clearly labeled illustrated walkthrough. Its source and renderer live in `packages/brand-tokens/film`; no sample page is presented as a verified grant result.

### Control & Trust

- A live “Agent is working” indicator shows each step; a **Stop** button cancels instantly.
- Every task runs on a weighted step budget (default 40): it warns at 75%, stops at the limit, and can be raised per task.
- Form submissions and downloads require explicit confirmation.
- Choose Claude Opus, Sonnet, or Haiku per task.

### Voice

The microphone button dictates a single message. **Voice Mode** starts a live
spoken conversation: hear replies, interrupt playback, and ask the assistant
to work in your browser. Both buttons sit on the right of the message composer.
Browser tasks retain their normal progress feed and confirmation controls.

Voice uses local English Whisper transcription and a natural-sounding female
voice that ships with the app, with no speech API key. Replies are generated on
your device; the recognition model downloads on first use and works offline afterward.
Mute pauses capture; **Stop Voice Mode** releases the microphone and cancels its
browser task. Without a cloud key, spoken browser commands use the local assistant.

### Privacy

- Local mode processes page summaries on your device; optional cloud mode sends prompts directly to the selected provider.
- Optional provider keys are encrypted and stored on your device.
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
