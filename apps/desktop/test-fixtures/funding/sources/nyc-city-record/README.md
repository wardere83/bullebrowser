# NYC City Record Online recorded answers

Real answers from the City Record Online dataset on NYC Open Data, used by
`src/main/opportunities/sources/nyc-city-record.test.ts`. No test calls the
network.

- **Recorded on:** 6 October 2026, at about 12:35 UTC.
- **Service:** `GET https://data.cityofnewyork.us/resource/dg92-zbpx.json`. It
  needs no key.
- **How:** by running the adapter itself against the live service, so each
  request is exactly the one the adapter builds.

Each file holds the request that was sent and the answer as it came back,
apart from what was removed (see below):

```json
{ "recordedOn": "2026-10-06", "request": { "url": "…" }, "response": [ … ] }
```

Notices change every business day. These files describe that one day and are
not expected to match the live service later.

## What was removed

No notice was added or reworded.

- **Rows.** The search answers were cut down to the notices named below (the
  live answers held 103 open notices and the 200 most recent past ones). The
  answers are plain lists, so nothing else had to change.
- **Named staff.** `contact_name` was removed from every notice. `contact_phone`
  was removed unless it was the placeholder "(000) 000-0000", and `email` was
  removed unless it was a shared mailbox. The portal leaves out a column it has
  no value for, so a removed field looks exactly like one that was never
  filled in.

## Searches

All three ask for notices in the Procurement section, typed "Solicitation", in
the three service categories.

| File | Request | Rows kept |
| --- | --- | --- |
| `search-open` | due on or after 6 Oct 2026, every column | 12 notices: 20260903027 (sparse), 20260825032, 20260923001 (an extension of a notice now past), 20260924014 (complete), three notices for one procurement, 81622P0004, due 2026, 2034 and 2034 (20260408021 is the latest), 20221021120 and 20220805113 (a label where the procurement number belongs; due 2028 and 2099), 20260415039 (due 2099), 20210623125 (due in the year 9999; its text says it is closed), 20200727109 (titled "Cancellation"; due 9999; six attached documents) |
| `search-past-outline` | due before 6 Oct 2026, six columns, latest 200 | the same five notices as `search-past` |
| `search-past` | due before 6 Oct 2026, every column, latest 200 | 20260825023, 20260811020 (extended by 20260923001), 20260429002 and 20260227028 (two notices for one procurement), 20260319029 (titled "Cancellation") |

## Notices

| File | Notice | Why it is here |
| --- | --- | --- |
| `detail-20260924014` | Medical Malpractice Defense Services | a short procurement number, so no later notice is looked for |
| `detail-20250206003` | Justice Involved Supportive Housing, the 2025 notice | due 2034; a later notice exists |
| `latest-notice-81622P0004` | the latest notice for that procurement | 20260408021, due 31 Dec 2026 |
| `detail-20200727109` | Cancellation: Landscape Maintenance | six document addresses packed into one value |
| `latest-notice-85620B0005` | the latest notice for that procurement | the same notice: nothing later |
| `detail-unknown` | id 19990101001 | whole answer: an empty list |
