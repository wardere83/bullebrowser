# Montgomery County Solicitations recorded answers

Real answers from the "Solicitations" dataset on Montgomery County, Maryland's
open-data portal, used by `src/main/opportunities/sources/montgomery-md.test.ts`.
No test calls the network.

- **Recorded on:** 6 October 2026, between 12:30 and 12:43 UTC.
- **Service:** `GET https://data.montgomerycountymd.gov/resource/eeq6-nnwe.json`.
  It needs no key.
- **How:** by running the adapter itself against the live service, so each
  request is exactly the one the adapter builds.

Each file holds the request that was sent and the answer as it came back,
apart from what was removed (see below):

```json
{ "recordedOn": "2026-10-06", "request": { "url": "…" }, "response": [ … ] }
```

The dataset is rebuilt daily. These files describe that one day and are not
expected to match the live service later.

## What was removed

No solicitation was added or reworded.

- **Rows.** `search-closed` was cut down from 200 rows to the four named below.
  `search-active` holds all 16 rows the county listed as Active that day.
- **Named staff.** `buyer` (the procurement specialist) was removed from every
  row except where the county itself wrote "--". `deptcontact` was removed
  where it named an individual and kept where it named a team. The portal
  leaves out a column it has no value for, so a removed field looks exactly
  like one that was never filled in.

## Files

| File | Request | Rows |
| --- | --- | --- |
| `search-active` | status `Active` | all 16: nine with a closing date still to come (two reserved for local small businesses), and seven also marked "Cancelled or Indefinitely Postponed" with no closing date |
| `search-closed` | status `Closed` with a closing date, latest 200 | 1201132 (informal; reserved; closing the same day), 1201355 (with bid results), 1195158, 1183590 (a construction solicitation) |
| `detail-1197772` | the solicitation with that number | Active, closing 6 Nov 2026 |
| `detail-1201355` | the solicitation with that number | Closed, with a bid results link and a team as its contact |
| `detail-unknown` | number 0000000 | whole answer: an empty list |
