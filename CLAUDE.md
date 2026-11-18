# Working on BulleBrowser

Decisions and preferences from the owner. Read these before changing how the
app releases, searches or talks to people.

## How to work
- Finish work end to end: open the PR, address the bot reviews, merge, release
  and verify the result in the installed app. Do not ask the owner to do
  something you can do; ask only for what needs their account or consent.
- Save notes and decisions in this repository first, then in the BulleBrowser
  folders used outside it (Claude's project memory). Delete temporary files.

## Releases
- The owner approves publishing every build without the benchmark gate. See
  "Publishing without the benchmark gate" in docs/RELEASING.md.
- Users update with the green **Update App** button. v0.2.84's updater could
  not install updates (fixed in #84); a full disk also stops macOS installs.

## AI and search
- Never show an "out of credit" message. When the AI account has no credit,
  the app browses without AI instead (`isOutOfCredit` in agent/errors.ts).
- Sort each message first (`requestIntent`): conversation is answered in the
  chat, questions are answered and browse only when they need a source, and
  browser access is asked for up front only for browsing requests.
- Search without a key uses Startpage (Google's results), then Bing.
  BulleBrowser hides Startpage's ads for every user. Engines blocked by the
  destination policy stay blocked. Never try to get around a CAPTCHA.
- Never suggest options that charge for API usage (search APIs, paid
  services). Free options only.

## Saved passwords
- BulleBrowser saves and fills sign-ins itself (src/main/passwords). Passwords
  are encrypted with safeStorage (the macOS Keychain), filled only into the
  exact site they were saved for, and never given to the agent.
- Touch ID passkeys (Electron's app.configureWebAuthn) need a Developer ID
  provisioning profile with Keychain Sharing first; without it the Mac app can
  fail to launch. Passwords and passkeys from Apple Passwords need Apple's web
  browser entitlement, which Apple grants on request.
