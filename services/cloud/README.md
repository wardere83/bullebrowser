# BulleBrowser shared cloud — staging foundation, NOT launch-ready

This replaces neither the desktop nor the CRM backend yet. Do not enable
production billing. The old installation-ID gateway is not suitable for paid
public access. Never distribute service-role, payment or model-provider secrets.

## Render setup (you can leave before deploying)

Select `wardere83/bullebrowser`, branch `main`, runtime Node, repository-root
working directory. Build: `corepack enable && pnpm install --frozen-lockfile && node services/cloud/build.mjs`.
Start: `node services/cloud/dist/server.mjs`. Health path: `/health`.
Use Node 22. Keep `CLOUD_ENABLED=false` and `BILLING_ENABLED=false`.
Do not deploy until this code has been pushed and the missing pieces below are
complete. No paid plan or resource is authorized or provisioned by these files.

## Accounts and database

Create a Supabase project. Enable public email signup, require confirmation,
configure CAPTCHA and email rate limits, and supply production SMTP delivery.
Use email OTP with the email template's Token variable. The client verifies the
code via Supabase and stores refresh credentials in OS secure storage, not the
renderer or localStorage. Client sign-in/refresh UI is NOT implemented yet.

Run `schema.sql` in the SQL editor in staging first. It enables RLS, denies
client-side mutations and grants service-role-only RPC access. The backend
validates every bearer token via Supabase Auth and requires confirmed email.
Local installation IDs and client-provided plan names cannot grant access.

Render Environment secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `BRAVE_SEARCH_API_KEY`. The GitHub Actions secrets
do not transfer automatically. Never paste the entire development .env file.

## Search quotas

Free: 10/day; Individual $15.99: 500/month; Pro Plus $20.99: 1000/month;
Pro Max $30.99: 1800/month. Windows use UTC calendar periods in this foundation;
paid subscription billing-cycle alignment must be implemented before launch.
Allocation is transactional across instances. Ambiguous upstream errors stay
charged, since the provider might already have incurred cost. Usage is visible
at authenticated `GET /usage`. `POST /search` never stores the query in the DB.

Global search cap defaults to 1,000/month across the entire deployment, including
paid accounts. Change `bb_service_limits` deliberately after cost review; never
call this a currency cap or an AI-model spending cap. Exhaustion returns 402.
There is no automatic overage billing.

## Billing safety and remaining implementation

Webhook signatures are checked over raw bytes with freshness validation; verified
events are queued idempotently. They do not grant paid entitlements yet.
`/billing/checkout`, `/billing/top-up` and `/models/*` deliberately return 503.
Before charging anyone, implement and test:

- Stripe customer binding, fixed price IDs matching the approved tier prices,
  Checkout, portal, invoice reconciliation, cancellation, refunds, disputes and
  duplicate/out-of-order webhook handling. Retrieve authoritative Stripe state.
- Atomic model credit ledger: reserve worst-case cost before each provider call,
  settle measured tokens/cached tokens, hold uncertain reservations, restrict
  allowed models/output tokens, enforce per-task and global budgets. The text
  estimator in `plans.mjs` is NOT enabled for real charges or image/audio inputs.
- Approved included AI credits, markup and prepaid top-up prices. Those product
  decisions are still unset; never invent a charge or advertise an allowance.
- Email auth/refresh/logout UI, hosted-model SDK routing and shared-search
  desktop transport, account/usage/upgrade screens, CAPTCHA integration.
- Staging PostgreSQL concurrency/RLS tests, provider/payment sandbox tests,
  end-to-end desktop checks, abuse controls, retention and operations monitoring.

Tests: `node --test services/cloud/cloud.test.mjs`. Build:
`node services/cloud/build.mjs`. Unit tests do not validate deployed database
permissions or prove a production-ready billing system.
