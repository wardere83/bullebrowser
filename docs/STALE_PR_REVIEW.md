# Stale pull request review

Reviewed against main after updater PR #84. Recommendations only: none of these
pull requests was merged or closed as part of this review.

| PR | Recommendation | Reason |
| --- | --- | --- |
| #69 | Rebase and reduce scope | Destination blocking and safe session restoration already exist on main. Retain only demonstrated missing updater callback/readiness guards; preserve the explicit restart flow from #84. The branch conflicts with main. |
| #36 | Close after confirming release artifacts | Main already has dedicated `afterSign`, entitlements, notarization and Gatekeeper verification. A second notarization path risks conflicting with those hooks. Confirm signed artifacts before treating the older proposal as obsolete. |
| #20 | Close as superseded | Main cleans window-scoped IPC handlers on close and uses shared network activity tracking. The old per-call listener cleanup must not replace current shared listeners. |
| #37 | Close as superseded | Main already requires Next.js 15.5.28, beyond the proposed 15.5.21 update. |
| #39 | Close as superseded | Main already requires/overrides PostCSS 8.5.23, the version proposed here. |

Keep #70 open until signed activation and the documented session-restoration
limits have been reviewed. A code merge is not proof that a new installer is live.
