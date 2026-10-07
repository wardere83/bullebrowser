# BulleBrowser

> Strategic funding for businesses and CBOs.

BulleBrowser is a desktop browser by [Bulle Consulting](https://bulleconsulting.com) that connects official funding opportunities with your organization’s mission, priorities and documented strengths.

**Website:** [bullebrowser.com](https://bullebrowser.com)

## Funding workflows

The assistant and dashboard offer four actions:

- **Find Relevant Grant Opportunities** — filter official listings by jurisdiction, recipient geography, eligibility, category, award amount, deadline and verified status.
- **Assess Our Funding Alignment** — compare funder requirements with approved organization statements and cited document evidence.
- **Explore Funder Priorities** — read the funder’s stated priorities, expected outcomes and evaluation criteria, with interpretation labelled separately.
- **Ethical Strengths-Based Proposal Guide** — reflective questions, evidence checklists, outlines and comments on your own writing; restricted AI policies disable tailored outlines and draft feedback.

The **Organization Knowledge Hub** reads PDF, DOCX, TXT and Markdown files, lets you inspect, replace and delete them, and searches extracted passages. Profile statements and priorities require explicit approval before they guide funding work. Replaced or deleted evidence triggers review. Funding notices stay in RFP Analysis rather than becoming organization memory.

Each organization has its own stored documents, searchable index, approved profile, saved listings, RFPs and guides. Access uses the existing device-local identity and organization roles. This is not a hosted account or team synchronization service.

Without an assistant key, document extraction, search, verbatim profile proposals, literal RFP findings and reflective guides work locally. A connected assistant adds cited educational analysis, alignment interpretation and draft feedback after organization consent. Live discovery queries the six connected official sources; unsupported portals remain explicitly marked as links to visit.

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
