# Installing BulleBrowser

BulleBrowser is a desktop app for **macOS, Windows, and Linux**. This guide
gets you from download to a working AI agent in a few minutes — no technical
background needed.

> Downloads live on the [Releases page](https://github.com/wardere83/bullebrowser/releases/latest).
> The website's **Download** button picks the right file for your computer
> automatically.

---

## 1. Download

| Your computer | File to download |
|---------------|------------------|
| Mac (Apple Silicon) | `BulleBrowser-<version>-arm64.dmg` |
| Mac (Intel) | `BulleBrowser-<version>-x64.dmg` |
| Windows 10/11 | `BulleBrowser-Setup-<version>-x64.exe` |
| Windows on ARM | `BulleBrowser-Setup-<version>-arm64.exe` |
| Linux (most PCs) | `BulleBrowser-<version>-x86_64.AppImage` |
| Linux (ARM) | `BulleBrowser-<version>-arm64.AppImage` |

Not sure which Mac you have? Apple menu →  **About This Mac**. If it says
"Apple M…", choose Apple Silicon.

---

## 2. Install & first launch

### macOS
Official releases are **Developer ID–signed and notarized by Apple**, so they
open normally — no security workaround needed.

1. Open the `.dmg` and drag **BulleBrowser** into **Applications**.
2. Double-click **BulleBrowser** in Applications to launch it.

> Building from source or running an unofficial/dev build? Those aren't
> notarized, so macOS may say the app "can't be opened" or "is damaged."
> Right-click → **Open** → **Open**, or clear the quarantine flag:
> ```bash
> xattr -dr com.apple.quarantine /Applications/BulleBrowser.app
> ```

### Windows
1. Run `BulleBrowser-Setup-…exe`.
2. If **Windows SmartScreen** appears, click **More info → Run anyway**.
3. Follow the installer; BulleBrowser opens when it finishes.

### Linux
```bash
chmod +x BulleBrowser-*.AppImage
./BulleBrowser-*.AppImage
```
If your distro lacks FUSE, run `./BulleBrowser-*.AppImage --appimage-extract`
and launch `squashfs-root/AppRun`.

---

## 3. (Optional) Verify your download

Each release includes `checksums.txt`. To confirm your file is intact:

```bash
# macOS / Linux
shasum -a 256 BulleBrowser-*.AppImage      # compare against checksums.txt

# Windows (PowerShell)
Get-FileHash .\BulleBrowser-Setup-*.exe -Algorithm SHA256
```

---

## 4. Open the assistant

BulleBrowser is bring-your-own-key: add your **Anthropic API key** in
**Settings** (it's stored encrypted in your OS keychain and used only to talk
to Anthropic). The agent needs it to browse and answer.

1. Open the **assistant panel** (the **Your Assistant** button, or
   `Ctrl/Cmd + Shift + A`).
2. Choose a preset skill if you want a guided workflow, or just describe
   what you need in plain language.
3. The agent browses your live tabs — navigating, reading, and following
   links as needed — then returns a grounded answer with sources.

Preset **Skills**:
- **Page assistant** — read and summarize the current page.
- **Site navigator** — open a site, find the control, and complete the requested action.
- **Workflow automator** — coordinate repeatable multi-step browser tasks.

---

## Keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| New tab | `Ctrl/Cmd + T` |
| Close tab | `Ctrl/Cmd + W` |
| Focus address bar | `Ctrl/Cmd + L` |
| Reload | `Ctrl/Cmd + R` |
| Toggle AI panel | `Ctrl/Cmd + Shift + A` |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Mac: "can't be opened" / "is damaged" | Official releases are notarized and open normally. If you're on a source/dev build, right-click → Open → Open, or run the `xattr -dr` command above. |
| Windows: SmartScreen blocks it | More info → Run anyway. |
| AI panel asks for a key | Add your Anthropic API key in Settings — the agent needs it to browse and answer. |
| Agent can't read a page | Some PDFs/non-HTML pages aren't readable; paste the text or use an HTML version. |
| Updates | Verified updates download in the background. Click **Update** to install and automatically reopen your tabs and chat. Native updates require a brief restart. |

Questions? <hello@bulleconsulting.com>
