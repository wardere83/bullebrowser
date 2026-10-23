# BulleBrowser CRM widget backend

The widget operates the user's logged-in EEO Dashboard page. Model credentials
belong only on the backend, never in page code.

## Authentication prerequisite

Implement token issuance in the trusted CRM server after validating its user
session. Sign an HS256 JWT with `WIDGET_AUTH_SECRET` (32+ random characters).
Required claims: `sub` (globally unique authenticated user ID),
`aud: "bullebrowser-widget"`, and `exp` (seconds, at most 15 minutes ahead).
Supply this JWT as the widget's `data-token`; reinitialize with a fresh token
after expiry. Never mint tokens in the browser or embed a static shared secret.
Streams expire with the token. Task and tool-result routes verify ownership.

Ordinary users have browser DOM tools subject to the CRM's page permissions.
Account API tools require BOTH `role: "admin"` and
`permissions: ["eeo:account"]`, granted only by trusted server authorization.
These tools are not district-scoped; do not grant them to district users.

## Deployment

Build: `node services/widget-backend/build.mjs`.
Start: `node services/widget-backend/dist/server.mjs`.

Environment settings:

- `ANTHROPIC_API_KEY`: backend-only model credential.
- `WIDGET_AUTH_SECRET`: JWT signing secret shared with the trusted CRM server.
- `ALLOWED_ORIGINS`: comma-separated exact approved CRM origins.
- Optional `EEO_PUBLIC_ID`, `EEO_SECRET_KEY`, `EEO_BASE_URL`: account API settings.

`render.yaml` is a deployment template. `/health` is public. Use HTTPS and redact
query strings in proxy logs: EventSource carries its short-lived token in its URL.
GitHub Pages cannot host this backend.

Embed `https://bullebrowser.com/widget.js` with `data-endpoint` pointing to the
backend and `data-token` populated by the authenticated CRM server. Never put a
permanent credential in a public dashboard or repository.

## Approval and verification

Destructive actions request confirmation through the active widget; rejection
or missing confirmation denies the action. Confirmation expresses intent, not
authorization, and does not replace server-side permission checks.

Run `node --test services/widget-backend/auth.test.mjs`. Production rollout still
requires CRM token issuance, hosting/CORS setup, and end-to-end role testing.
