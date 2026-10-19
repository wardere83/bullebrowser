# Releasing BulleBrowser

End-to-end checklist for shipping a new version.

## 0. Prerequisites (one-time)

### GitHub repository secrets

Configure the following under **Settings → Secrets and variables → Actions**:

| Secret | Used by | Purpose |
|---|---|---|
| `MACOS_CERTIFICATE` | `build-desktop.yml` | Base64 of the `.p12` **Developer ID Application** certificate |
| `MACOS_CERTIFICATE_PASSWORD` | `build-desktop.yml` | Password for the `.p12` |
| `WINDOWS_CERTIFICATE` | `build-desktop.yml` | Base64 of the `.pfx` Authenticode signing certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | `build-desktop.yml` | Password for the `.pfx` |

Plus **one** of the two macOS notarization credential sets:

| Apple-ID method | Purpose |
|---|---|
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password generated at appleid.apple.com |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID |

| App Store Connect API-key method (preferred) | Purpose |
|---|---|
| `APPLE_API_KEY` | Base64 of the `.p8` API key (decoded to a temp file in CI) |
| `APPLE_API_KEY_ID` | Key ID of the App Store Connect API key |
| `APPLE_API_ISSUER` | Issuer ID of the App Store Connect API key |

> **Important:** macOS public releases (tagged `v*.*.*`) must be Developer ID–signed
> and notarized so Gatekeeper accepts them without any "unidentified developer" /
> "is damaged" prompt. The workflow **hard-fails** a tagged release when the
> signing/notarization secrets are missing, and the afterSign hook
> (`apps/desktop/scripts/notarize.cjs`) hard-fails if the produced app isn't
> notarized + stapled + Gatekeeper-accepted — so an un-notarized DMG can never
> be published. Non-tag runs fall back to an ad-hoc-signed build for testing.

The landing page deploys to **GitHub Pages** — no third-party host and
no secrets required.

### Enable GitHub Pages (one-time)

1. Go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or run the `deploy-web` workflow manually). The
   `deploy-web.yml` workflow builds the static export and publishes it.

That alone makes the site live at the project URL:
`https://wardere83.github.io/bullebrowser/`.

### Custom domain `bullebrowser.com` (optional, free)

The repo ships `apps/web/public/CNAME` pinned to `bullebrowser.com`, so
the build is already configured for the apex domain. To activate it:

1. At your domain registrar, add the GitHub Pages **apex A records**:
   - `A  185.199.108.153`
   - `A  185.199.109.153`
   - `A  185.199.110.153`
   - `A  185.199.111.153`
   - (optionally the matching `AAAA` records for IPv6)
   - `www.bullebrowser.com` → `CNAME wardere83.github.io`
2. In **Settings → Pages → Custom domain**, enter `bullebrowser.com` and
   tick **Enforce HTTPS** once the certificate is issued.

To preview at the **project URL before DNS is ready**: delete
`apps/web/public/CNAME` and set a repository variable
`PAGES_BASE_PATH=/bullebrowser` (**Settings → Secrets and variables →
Actions → Variables**). The workflow reads it and builds with that base
path so assets resolve under `/bullebrowser/`.

## 1. Bump the version

```
# in repo root
pnpm version --workspaces patch    # or minor / major
git add .
git commit -m "chore(release): bump to v$(node -p "require('./apps/desktop/package.json').version")"
git push origin main
```

## 2. Tag the release

```
TAG="v$(node -p "require('./apps/desktop/package.json').version")"
git tag "$TAG"
git push origin "$TAG"
```

The push to a `v*.*.*` tag triggers `build-desktop.yml`, which:

1. Runs typecheck + tests in parallel on macOS, Windows, and Linux runners.
2. Builds the Electron app on each platform with code signing. On macOS the
   app is **Developer ID–signed** with hardened runtime + entitlements
   (`resources/entitlements.mac.plist` / `entitlements.mac.inherit.plist`).
3. **Notarizes** the macOS app via `xcrun notarytool submit --wait`,
   **staples** the ticket (`xcrun stapler staple`), and **validates**
   Gatekeeper acceptance (`stapler validate` + `spctl --assess --type execute`)
   in the afterSign hook — then a separate workflow step re-verifies the
   produced `.app` bundles. Any failure on a tagged release aborts the run.
4. Computes SHA-256 checksums.
5. Publishes a GitHub Release with all installers and `checksums.txt`
   attached, plus auto-generated notes from Conventional Commits since
   the previous tag.

### Publish now (no local tag tooling)

If you need downloads live immediately and do not want to create/push a
tag locally, run `build-desktop` manually:

1. Go to **Actions → build-desktop → Run workflow**.
2. Set `version` to a semver like `0.2.0`.
3. Leave `publish_release` as `true`.

The workflow stamps package versions for the build, produces signed
installers per platform, and publishes a GitHub Release at
`v<version>` from the selected commit.

### If macOS shows "could not verify free of malware"

That means the downloaded app is not notarized by Apple (usually from an
internal/manual build). For temporary local testing only, you can run:

```
xattr -dr com.apple.quarantine /Applications/BulleBrowser.app
```

For public distribution, do not use this workaround. Re-run release with
all notarization secrets configured so Gatekeeper verifies the build.

## CI safeguards (added after v0.2.0 incident)

To prevent CI regressions that can invalidate entire release runs:

1. The `ci.yml` quality job rejects any step-level workflow condition that
   references `secrets.*` directly in `if:`.
2. `build-desktop.yml` probes macOS secret availability into step outputs
   and gates signing/notarization steps on those outputs.
3. Desktop smoke launch helper is idempotent to AI panel default state
   (open or closed), so default-setting changes do not break e2e startup.

## 3. Verify the release

- Download each installer from the release page and run it on a clean VM.
- Confirm the in-app About page shows the new version and a populated
  third-party-notices table.
- Confirm `electron-updater` picks up the release (older builds will
  prompt to update on next launch).

## 4. Deploy the web changes

The `deploy-web.yml` workflow runs automatically on any push to `main`
that touches `apps/web/**` or shared packages, building the static
export and publishing it to GitHub Pages. The download page and the
home-page download button fetch the latest release directly from the
GitHub API in the visitor's browser, so a freshly published release
shows up on the site as soon as the GitHub API reflects it (no rebuild
of the site required).

## 5. Rollback

If a release is broken:

1. Mark the GitHub Release as **draft** so users on stale clients don't
   auto-update.
2. Tag the previous good version as `latest` by editing the older release.
3. Investigate, ship a fix, and follow steps 1-4 again.

## Conventional Commit cheatsheet

```
feat(scope):  user-visible new capability
fix(scope):   bug fix
perf(scope):  speed/memory improvement
refactor:     internal change, no behavior delta
docs:         docs only
chore:        tooling, configs, deps
```

Allowed scopes: `desktop`, `web`, `agent-core`, `brand-tokens`,
`release`, `docs`, `repo`.


## Non-disruptive update contract

- Only published releases appear in installed apps. A commit or build in progress is not an installable update.
- The Updates control is always visible. Installed builds check at startup, once per minute, on focus, and on request. Network failures have bounded retries.
- Progress reflects download events; transfer completion is held below 100% until native verification/preparation completes. The glossy animation respects reduced motion.
- Clicking Update never calls quitAndInstall, quits, relaunches, or stops an active task. Verified native packages apply on the next normal quit/launch. Native Electron/main-process changes cannot replace already-running code without a process restart; never label a prepared version as the running version.
- On the next launch, reconcile the prepared receipt against app.getVersion(). A stale or different app copy produces a recovery explanation. Disk-image/translocated Mac copies must be moved to Applications and opened there before updating.
- Users stuck on a previously broken updater need a one-time install from https://bullebrowser.com/download. Replacing the running signed bundle or bypassing code-signature validation is not a supported shortcut.
- Before shipping, run updater/receipt tests, the full desktop unit suite, type checks, lint, build, and the headless update UI smoke tests. Verify the published native assets, update manifests, and website manifest all name the new version.
