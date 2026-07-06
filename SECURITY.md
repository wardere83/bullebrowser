# Security Policy

We take the security of **BulleBrowser** and **bullebrowser.com** seriously.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** — do **not** open a
public GitHub issue.

- Email: **security@bullebrowser.com** (also reachable at
  `hello@bullebrowser.com`)
- Or use **GitHub's private vulnerability reporting** at
  <https://github.com/wardere83/bullebrowser/security/advisories/new>

Please include, where possible:

- A short description of the issue and its impact.
- Steps to reproduce (proof-of-concept code, URLs, or video helps).
- The affected version (`Settings → About` in the desktop app, or the
  commit hash for the website).
- Your operating system and version.

You can expect:

- An acknowledgement within **3 business days**.
- A first assessment within **10 business days**.
- A coordinated fix and public disclosure once a patch is available.

## Supported versions

| Surface | Supported |
|---|---|
| Desktop app — latest GitHub Release (`main` branch) | ✅ |
| Desktop app — older releases | Best-effort upgrade guidance |
| Website (`bullebrowser.com`) | ✅ (always tracks `main`) |

## Scope

- The BulleBrowser desktop application (source under `apps/desktop/`).
- The `bullebrowser.com` static website (source under `apps/web/`).
- The agent core library (source under `packages/agent-core/`).
- Released installers on the [Releases page](https://github.com/wardere83/bullebrowser/releases).

Out of scope (please don't report):

- Vulnerabilities in third-party services the user opts into (e.g., the
  configured AI provider API, websites the agent navigates).
- Social-engineering attacks against BulleBrowser staff.
- Findings that require physical access to a user's device.

## Privacy & data handling

BulleBrowser is **bring-your-own-key**. The desktop app stores the
configured AI provider API key encrypted in the operating system's keychain
(Keychain on macOS, libsecret on Linux, DPAPI on Windows). Browsing
history, bookmarks, and agent conversations are stored on the user's
device only. There is **no telemetry** in v1, and the website does not
run analytics or third-party trackers.

## Hardening summary

- **Desktop app:** Electron with `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`. The agent has a hard
  25-tool-call cap per task, an always-available Stop button, and
  explicit confirmation prompts for destructive actions.
- **Website:** static export served by GitHub Pages over HTTPS
  (Let's Encrypt). A strict **Content-Security-Policy** is enforced via
  `<meta http-equiv>`, and **Referrer-Policy:
  strict-origin-when-cross-origin** is set via `<meta name="referrer">`.
  GitHub Pages can't emit arbitrary HTTP response headers, so
  HTTP-header-only protections (HSTS, `X-Content-Type-Options`,
  `Permissions-Policy`, `X-Frame-Options`) would need a CDN proxy in
  front to take effect. External links carry `rel="noopener noreferrer"`.
- **Repository:** GitHub Dependabot alerts, Dependabot security
  updates, secret scanning, and CodeQL are enabled (or recommended) on
  the public repository.

Thank you for helping keep BulleBrowser and its users safe.
