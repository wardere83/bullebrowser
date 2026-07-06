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
| Mac | `BulleBrowser-<version>-universal.dmg` |
| Windows 10/11 | `BulleBrowser-Setup-<version>-x64.exe` |
| Windows on ARM | `BulleBrowser-Setup-<version>-arm64.exe` |
| Linux (most PCs) | `BulleBrowser-<version>-x86_64.AppImage` |
| Linux (ARM) | `BulleBrowser-<version>-arm64.AppImage` |

Not sure which Mac you have? Apple menu →  **About This Mac**. If it says
"Apple M…", choose Apple Silicon.

---

## 2. Install & first launch

BulleBrowser is currently distributed **unsigned** (no paid Apple/Microsoft
developer certificate yet), so your OS will show a one-time safety prompt.
This is expected — here's how to get past it.

### macOS
1. Open the `.dmg` and drag **BulleBrowser** into **Applications**.
2. In Applications, **right-click** BulleBrowser → **Open** → **Open**.
   (Right-clicking is the key step — double-clicking the first time may say
   the app "can't be opened".)
3. After this one time, it launches normally from the Dock.

If you ever see *"BulleBrowser is damaged"*, it's just the quarantine flag.
Open Terminal and run:
```bash
xattr -dr com.apple.quarantine /Applications/BulleBrowser.app
```
then open it again.

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

## 4. Turn on the AI agent (bring your own key)

BulleBrowser uses **your own AI provider API key** — your prompts go straight
through your provider from your device.

1. Get a supported API key (it currently starts
   with `sk-ant-`).
2. In BulleBrowser, open the **profile menu** (top-right) → **Settings**.
3. Paste your key into **BulleBrowser AI key** → **Save**. It's stored
   encrypted in your operating system's keychain.
4. Open the **AI panel** (the **AI** button, or `Ctrl/Cmd + Shift + A`).

You're ready. Try a preset **Skill** from the dropdown:
- **Grant scanner** — give it keywords; it searches SAM.gov & Grants.gov and
  returns a comparison table.
- **RFP comparator** — paste 2–4 RFP links for a side-by-side breakdown.
- **Compliance review** — drop a document; it flags EEO / FERPA / ADA issues.

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
| Mac: "can't be opened" | Right-click → Open → Open (step 2 above). |
| Mac: "is damaged" | Run the `xattr -dr` command above. |
| Windows: SmartScreen blocks it | More info → Run anyway. |
| AI panel says "add an API key" | Settings → paste your `sk-ant-…` key. |
| Agent can't read a page | Some PDFs/non-HTML pages aren't readable; paste the text or use an HTML version. |
| Updates | BulleBrowser checks GitHub Releases and updates itself on the next launch. |

Questions? <hello@bullebrowser.com>
