# BulleBrowser mobile and browser connectors

## What this change supplies

A React 19 mobile application hosted by Capacitor 8.5 for iOS and Android, reusing the existing agent-core loop, identity protections, funding instructions, budget and consequential-action policy. A dedicated unprivileged WKWebView/Android WebView renders the real browsing surface beside the mobile assistant. Remote pages never receive the Capacitor bridge or assistant key. The existing desktop page helpers supply target inspection, action previews and the visible cursor; the mobile adapter reports unsupported operations rather than pretend they succeeded.

The same 50-service browser connector catalog runs on desktop and mobile. Users search by service name, explicitly enable services, sign in on the service's own website, or add up to 50 custom public HTTPS websites. Tools resolve the live catalog and recheck revocation after browsing consent. A connector opens a real tab, then existing browser tools read/click/type under their existing approval policy. These are **browser-backed connections**, not imported ChatGPT/Claude OAuth grants or direct API/MCP integrations. Provider connector directories change and access depends on accounts, plans and workspace restrictions; this catalog does not claim exhaustive parity with either provider's live directory. A service absent from the catalog can be added by HTTPS address, subject to its browser compatibility.

Desktop permissions are device-local. They do not create organization authorization or grant access the signed-in service account lacks. Disabling a connector removes the assistant shortcut, not ordinary browser access. Users sign out on the source website to end that session. Mobile “Clear browser data” clears its browser sessions and tabs; it does not sign out of other installed apps.

## Architecture and rationale

```
React mobile UI (trusted packaged assets; restrictive CSP)
  ├─ Settings: browsing / selected files / external app links (all OFF initially)
  ├─ Searchable connectors + custom HTTPS services
  ├─ Shared runAgent + native model transport
  └─ Typed MobileAgent bridge
      ├─ Separate unprivileged native browser tabs (maximum 12)
      ├─ Fixed provider endpoints; no redirect following or JS-held provider keys
      ├─ iOS Keychain / Android Keystore-backed AES-GCM credential storage
      └─ System-approved file picker and reviewed external-link handoff
```

Capacitor is a new **native mobile host**, justified because Electron does not target iOS/Android. It retains the repository's React/TypeScript/Vite toolchain and shared browser agent rather than introduce React Native, a second state library, a model backend or cloud browsing service. The mobile bridge performs only platform operations and model HTTP transport; it does not change reasoning. Android declares no AccessibilityService, all-files permission or installed-app enumeration. Device backup is disabled for its device-bound encrypted credentials. The iOS privacy manifest declares the actual UserDefaults use; final store privacy disclosures still need review against the shipped app and provider data flow.

`packages/agent-core/src/browser-host.ts` extracts the existing desktop host instructions unchanged. Mobile changes the host label and states actual mobile limitations. No approved organization profile is automatically copied to a phone. Selected attachments are untrusted reference material, never implicitly an approved profile. Organization-specific fit/eligibility claims require approved grounding; the mobile app currently supports public-source research without desktop organization synchronization.

## Supported mobile access and current limits

- Browsing is opt-in in Settings and checked again natively for every browser command. Ordinary HTML navigation, reading, links, tab management, form inputs, target inspection and previewed consequential confirmations use the shared policy. Basic keyless browsing remains available; written model analysis uses a user-connected assistant.
- File access opens the system picker only after the user enables it. This version attaches one selected TXT/Markdown/CSV file under 100 KB to one task, clears it afterward, and never scans the phone. PDF/DOCX extraction on mobile is not implemented.
- External-app handoff uses reviewed HTTPS universal/app links and the operating system chooser. A setting does not authorize arbitrary control of other apps, their private files, contacts, photos, messages or payments. Native app APIs/App Intents/Android intents and separate permission flows are required for each additional capability.
- The app stops the current task when backgrounded. Background autonomous execution and desktop/mobile account/history synchronization are not implemented.
- Canvas/rich editors, cross-origin editor frames, mobile screenshot capture, native file uploads and popup-dependent flows are not yet supported by the adapter. Failures are shown explicitly for user takeover. Embedded-login restrictions and connector workflows need validation against real accounts on real devices. Do not market universal service support based solely on a catalog entry.

Apple documents that access outside an app uses explicitly provided system services and user-selected files: https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web and https://developer.apple.com/documentation/uikit/providing-access-to-directories . Android recommends scoped storage and narrow APIs: https://developer.android.com/training/data-storage/shared/documents-files and https://support.google.com/googleplay/android-developer/answer/10964491 . Reference connector directories: https://chatgpt.com/apps and https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities . These sources establish platform boundaries, not a guarantee of parity or store approval.

## Build and QA

Use Node 22+, pnpm 9.15 and the pinned lockfile. Native setup follows Capacitor 8 requirements: Xcode 26+ for iOS, Android Studio/SDK 36 and JDK 21 for Android. Generated native projects are intentionally ignored; `native/` source plus the pinned templates are authoritative. `native:init` is idempotent and fails if expected project template anchors change.

```
pnpm install --frozen-lockfile
pnpm --filter @bullebrowser/mobile typecheck
pnpm --filter @bullebrowser/mobile lint
pnpm --filter @bullebrowser/mobile test
pnpm --filter @bullebrowser/mobile build
pnpm --filter @bullebrowser/mobile native:init ios android
pnpm --filter @bullebrowser/mobile open:ios
pnpm --filter @bullebrowser/mobile open:android
```

Native CI builds an Android debug APK and an unsigned iOS simulator app for QA. Neither is an App Store/Play production release or a signed iPhone download. Mobile source does not alter installed desktop updates. A desktop merge may trigger the existing release workflow, so desktop regression tests are required independently.

Required device acceptance before a mobile release: fresh install/all toggles off; enable/revoke each access during a task; browser navigation/read/click/type with visible cursor; per-action approve/deny; Stop during provider request; app backgrounding; selected file only; provider key survives restart and clears correctly; malicious remote page cannot call native methods or read credentials; native Settings/approval never covered by browser; logout/data clearing; source/login failures reported; keyboard/VoiceOver/TalkBack; real connector accounts on both platforms. Do not mark these passed based on web UI fixtures or source parsing.

## Website and distribution

The download page lists iOS/iPhone/iPad and Android. Without configured verified listing URLs, it says **Coming soon** and renders no fake download button. Build variables:

- `NEXT_PUBLIC_IOS_APP_URL`: actual `https://apps.apple.com/.../id...` or `https://testflight.apple.com/join/...`.
- `NEXT_PUBLIC_ANDROID_APP_URL`: actual `https://play.google.com/store/apps/details?id=com.bullebrowser.mobile` or `https://play.google.com/apps/testing/com.bullebrowser.mobile`.

GitHub Pages maps repository variables `IOS_APP_URL` / `ANDROID_APP_URL` to these build variables. Beta URLs show “Join the beta.” Invalid hosts, credentials, schemes and other Android app IDs fail closed. All new download copy is translated in the five existing languages. The pending state remains until real store publication or beta enrollment links exist.

Publication requires Apple Developer and Play Console accounts, registered app identifiers, signing/provisioning, store listings, icons/screenshots, privacy disclosures, device QA and review. Those are not supplied by a source-code commit. Bundle ID defaults to `com.bullebrowser.mobile`; confirm it against the publisher's registrations before signing. No publishing credentials are stored in git and no store submission is attempted by the build workflow.

## Review evidence

Implementation is separated from the pending 14-workstream Agent UX plan; this does not begin those workstreams or imply their review is complete. Record commands and actual results in the PRs. Native project generation and Swift syntax/plist validation do not prove native compilation or device behavior. Keep native QA and store release unchecked until independently demonstrated.

## Results recorded during implementation

- Desktop typecheck/build/lint passed; 1,909 desktop tests passed and the real Electron connector E2E passed.
- Agent core coverage gate passed: 642 tests passed, one live credential-dependent test skipped.
- Mobile typecheck/lint/production web build passed; seven transport/authority tests passed.
- Native iOS and Android projects generated and synced; Swift syntax and project/privacy plists parsed successfully. Native binary compilation was not run locally: full Xcode and the Android SDK are absent.
- Chrome mobile UI fixture passed permission toggle/search/custom enable/revoke checks. Website static export and five-language copy checks passed, with two mobile URL tests and a browser test confirming pending downloads have no store links.
- The initial iOS simulator native CI build passed. Android SDK setup initially requested a retired tools package; the workflow now explicitly requests supported SDK packages. Real-device QA, source-account login matrix and store publication remain separate gates. Web bundle is approximately 158 KB gzip initially, including the existing agent engine; no claim of device performance is made from that number.
