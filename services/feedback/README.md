# BulleBrowser feedback receiver

A small Cloudflare Worker on the free plan that receives the thumbs up or down a
user gives a reply or a strategy playbook in the desktop app, with the comment
they chose to type. It stores them in a Cloudflare D1 database.

What is stored: the rating, whether it was a reply or a playbook, the comment,
the app version, the operating system and the time. A one-way hash identifies
the rated item so a changed rating replaces the old one. No reply text, no
account and no browsing data are sent. The sender's address is used only for a
daily limit and is kept as a salted hash that changes every day.

Limits: 60 ratings per address per day and 5,000 in total per day (see
`wrangler.toml`), 1,000 characters per comment and 4 KB per request.

## Going live

1. In Cloudflare, create an API token: My Profile, API Tokens, Create Token,
   then the "Edit Cloudflare Workers" template. Add the permission
   Account, D1, Edit. Under Account Resources choose the BulleBrowser account,
   and under Zone Resources choose bullebrowser.com.
2. In GitHub, open the repository's Settings, Secrets and variables, Actions,
   and add two repository secrets: `CLOUDFLARE_API_TOKEN` (the token) and
   `CLOUDFLARE_ACCOUNT_ID` (shown on the account's Workers overview page).
3. Run the `deploy-feedback` workflow from the Actions tab. It creates the
   database, deploys the Worker at https://feedback.bullebrowser.com and checks
   that it answers. Later changes to this folder deploy on their own.

bullebrowser.com must be a zone on the same Cloudflare account, because the
Worker uses feedback.bullebrowser.com as its address.

## Reading the feedback

In the Cloudflare dashboard open Storage and Databases, D1, bullebrowser-feedback,
Console, and run:

```sql
SELECT updated_at, kind, rating, comment, version, platform FROM feedback ORDER BY updated_at DESC;
```

For a spreadsheet, set an `ADMIN_TOKEN` secret on the Worker and download
`https://feedback.bullebrowser.com/v1/feedback/export` with the header
`Authorization: Bearer <token>`.

## Tests

```bash
node --test services/feedback/worker.test.mjs
```
