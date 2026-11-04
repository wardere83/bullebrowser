# Dependency security review — 2026-11-03

The workspace audit fell from 86 findings (42 high, 38 moderate, 6 low) to five
moderate findings, with no high or critical findings remaining in the measured
lockfile. This is a point-in-time result, not a guarantee against future advisories.

Electron is upgraded from 39.8.10 to 42.11.18, and electron-builder and its Squirrel
package to 26.18.0. Electron now uses its maintained internal ZIP extractor instead
of the unpatched extract-zip package. The overrides retain compatible major lines
for brace expansion, XML parsing, IP parsing, selector parsing and browser data.
The Xcode UUID dependency uses the patched v11 API; a compatibility test exercises
actual project UUID generation. Vite, Vitest and coverage tooling use patched
releases within their existing major lines.

## Remaining moderate findings

- GHSA-g3hv-75wg-m249: minimatch 3/5/9/10 in lint, packaging and mobile tooling.
  The advertised fix is minimatch 11.0.1. Older consumers use different CommonJS
  APIs; a blanket major override can break linting or packaging.
- GHSA-3g3m-2fjr-6pw4: glob 13 in the Capacitor CLI's rimraf dependency.
  The advertised fix is glob 14.0.2; it needs a validated parent-tool upgrade.

These findings remain visible in audit output; no ignore list or audit suppression
was added. Complete elimination requires additional compatible parent upgrades or
reviewed patches. Do not describe this lockfile as vulnerability-free.

Validation: workspace typecheck, lint, full unit tests and builds, plus runtime
minimum-version, packaging-export and Xcode UUID compatibility checks. GitHub's
native and desktop UI matrix must also pass before merging. Signed packaging and
publication remain subject to the release benchmark gate.
