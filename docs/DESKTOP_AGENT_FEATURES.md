# Desktop agent — functional Comet features

The in-product agent panel (`apps/desktop`) is where the Comet-style features
run for real — against the live agent, not a demo. This documents the
capabilities added so they operate 100% functionally, and how they're wired.

The desktop app uses the shared agent loop. Without cloud credentials it runs
local summaries and explicit browser commands; configured cloud engines keep
their existing model-driven loop. Both paths use the same tool validation,
browser approvals, per-site permissions, cancellation, and run records.

## What was already real (unchanged)

- **Live agent + browser control** — the agent drives real tabs (navigate,
  read, click, type, screenshot) via CDP; steps stream into the panel.
- **Halo on the composer** — a rotating conic-gradient ring with
  idle/focus/typing/working states (`styles.css`, driven by `useInputActivity`).
- **Visible agent cursor** — the on-page pointer/halo the agent paints as it acts.
- **"Allow Access"** — the once-per-task browsing-consent prompt above the composer.

## What was added

### Attachments — the "+" menu (`AttachMenu.tsx`)
A Comet-style popover under the composer. Each item is functional:

| Item | Backing |
| --- | --- |
| **Upload your file** | Native picker (`dialog.showOpenDialog`) → files copied into `userData/session-files`, tracked in a store, **swept 8 days after upload**. Text files carry an excerpt the agent reads; binaries attach without one. |
| **Screenshot** | Captures the active tab (`webContents.capturePage`, the same call the agent's screenshot tool uses) → attached as a thumbnail chip. |
| **Projects** | Pick or create a project (name + standing instructions + files). Attaching one tells the agent the task belongs to it. |
| **Control Browser** | Ensures a live tab exists for the agent to drive and focuses the composer. |

Attachments show as removable chips above the input and flow to the run via a
new optional `AgentRunRequest.attachments` field.

### How attachments reach the agent (safe design)
The renderer sends only **references** (file ids, a project id, a screenshot
url). In `main/agent/run.ts`, `buildAttachmentAppendix()` resolves them from the
stores and folds their content into a Markdown appendix on the message sent to
the model — while the **clean** user text is what's stored in the conversation.
No `agent-core` change; the agent just receives a richer prompt.

### Pointer-to-latest
The conversation auto-follows the newest message while pinned to the bottom; if
the user scrolls up, a pointer button appears to jump back down (`AiPanel.tsx`).

### Brand-mark home
The BulleBrowser mark beside "+" opens `bullebrowser.com` in a new tab.

### Keyless local assistant

No setup key is needed to summarize a page, list tabs, show page details, list
links, extract page data, open a URL, click a quoted target, or type quoted text
into a quoted field. Unsupported requests show the local command capabilities;
they do not produce invented model answers. Cloud keys are optional in the
collapsed Settings section for open-ended reasoning and cloud-specific skills.

### Voice — dictation and spoken Voice Mode

- Dictation records a prompt, transcribes locally, and sends it to the selected
  assistant. Without a cloud key, its transcript runs through the local assistant.
- Voice Mode keeps the existing inline controls, captions, mute, stop, and
  browser-task approvals. Local speech recognition sends each utterance through
  the selected assistant; the system speech engine reads its actual result.
  Stop, Cancel browser task, or a spoken cancellation cancels the task owned by
  that voice session. Silent timed clips are ignored. Interrupt stops a spoken
  reply; capture pauses during playback to avoid feedback commands.
- Both use **Whisper tiny.en via Transformers.js** in main. Mono 16 kHz audio
  stays on the device, and speech needs no OpenAI key. The English model
  downloads on first use into `userData/voice-models` and works offline afterward.
  Local summaries and explicit browser commands need no key. Cloud synthesis is optional.
- The previous hosted realtime implementation remains available internally but
  is no longer used by the Voice Mode UI.
- macOS microphone permissions and the existing hardened-runtime entitlements
  continue to apply.

### Updating the installed app

Published releases download in the background. Click **Update App** in the top
bar to install the downloaded version and relaunch. After the updated app opens,
the button disappears; it returns only when a later release is ready. The app
checks at launch and hourly while open. A downloaded installer stays available
through network failures and is not repeatedly downloaded while awaiting install.

These changes reach installed users only after the PR is merged and the existing
signed release workflow successfully publishes its installers and update manifests.
Voice input and Voice Mode then use local transcription and system speech without
a speech API key; the first use downloads the English model.

## Files

New: `main/storage/session-files.ts`, `main/storage/projects.ts`, `main/voice.ts`,
`renderer/components/AttachMenu.tsx`, `renderer/components/VoiceOverlay.tsx`.

Changed: `shared/ipc.ts` (channels, types, bridge), `preload/index.ts`,
`main/ipc-handlers.ts`, `main/agent/run.ts`, `renderer/components/AiPanel.tsx`,
`renderer/styles.css`, `electron-builder.yml`, the two `entitlements.mac*.plist`.

## Verifying

```bash
pnpm --filter @bullebrowser/desktop typecheck   # types
pnpm --filter @bullebrowser/desktop test         # unit tests
pnpm --filter @bullebrowser/desktop build        # electron-vite bundle
```

All pass.

### The typecheck used to check nothing

`apps/desktop/tsconfig.json` is a *solution* file — `{"files": [], "references":
[...]}` — so `tsc --noEmit -p tsconfig.json` compiled **zero files** and always
exited 0. Real type errors (including a live crash) shipped undetected behind a
green check. The `typecheck` script now runs `tsconfig.node.json` and
`tsconfig.web.json` explicitly. If a desktop typecheck ever looks suspiciously
easy, confirm what it actually compiles (`tsc -p … --listFiles | wc -l`).

### What the unit tests cover

The logic that can't be driven headlessly is covered directly instead:

- `main/agent/attachments.test.ts` — the prompt appendix: inlining text files,
  describing binaries, expanding projects, skipping swept files, and the
  untrusted-data framing (a file containing "ignore all previous instructions"
  must still arrive labelled as inert data, *after* the warning).
- `main/storage/session-files.test.ts` — the 8-day sweep against a real temp
  filesystem (metadata *and* bytes), dotfile classification, excerpt capping,
  and the UUID guard that stops a renderer-supplied id from deleting an
  arbitrary file.
- `main/storage/projects.test.ts` — de-duping, missing-project guards, and
  read-side reconciliation of file counts against expired files.
- `main/voice.test.ts` — keyless inference, silent clips, input validation,
  model reuse, command ordering, and recovery after failures.
- `renderer/lib/local-voice.test.ts` — local recording, transcription, verified
  spoken results, mute, task cancellation, and late microphone permissions.

### Desktop verification

The Electron Playwright smoke suite exercises the composer, both voice controls
without OpenAI keys or any assistant keys, and a real synthetic MediaStream →
MediaRecorder → PCM → transcription IPC → browser approval → spoken result flow.
Provider transcription and assistant results are mocked in this UI check.

For real model inference, build the app and run from `apps/desktop`:

```sh
node scripts/check-local-voice.mjs /path/to/speech.wav
```

An optional second argument selects a packaged executable. The check recognizes
a real WAV without provider keys, restarts, and repeats with network blocked.
First use requires the model download. Live microphone quality, installed system
voices, live assistant responses, and Windows/Linux packages need manual checks.

Additional regression checks cover silence during long tasks, spoken cancellation
while a task is pending, recovery from playback/provider failures, and immediate
microphone release after dictation Send. Voice Mode waits 1.6 seconds of silence
before ending an utterance to allow natural pauses.

The manual checks `scripts/check-live-voice.mjs speech.wav [expected-text]` and
`scripts/check-voice-output.mjs` exercise real recorder/VAD/model recognition and
real system speech output. The live check fixtures only the assistant response.

Native speech dependencies install both x64 and arm64 variants for the host OS.
CI checks installation and host imports on macOS, Windows, and Linux; the
packaging hook rejects artifacts missing a target architecture's runtime.
