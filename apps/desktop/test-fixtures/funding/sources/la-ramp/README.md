# RAMP Los Angeles recorded answers

Real answers from the "RAMP Open Bid Opportunities" dataset on the City of Los
Angeles open-data portal, used by `src/main/opportunities/sources/la-ramp.test.ts`
and by `socrata.test.ts` beside it. No test calls the network.

- **Recorded on:** 6 October 2026, at about 12:30 UTC.
- **Service:** `GET https://data.lacity.org/resource/hf3r-utnq.json`. It needs
  no key.
- **How:** by running the adapter itself against the live service, so each
  request is exactly the one the adapter builds.

Each file holds the request that was sent and the answer as it came back,
apart from what was removed (see below):

```json
{ "recordedOn": "2026-10-06", "request": { "url": "…" }, "response": [ … ] }
```

The dataset is rebuilt every hour and holds open items only. These files
describe that one hour and are not expected to match the live service later.

## What was removed

Rows, and nothing else: the search answer was cut down from 276 rows to the 12
named below. No row was added or reworded, and no field was removed from a row
that was kept. The dataset names no individuals.

## Files

| File | Request | Rows |
| --- | --- | --- |
| `search` | every row, ordered by closing time | 232282 (closes the same day), 232033 (stage "Amended"), 231831 (Port of Long Beach), 231906 (school district; category "None"), 232195 (Metro), 232376 and 232319 (Los Angeles County; type "None"; the closing time is also in the title), 231883 (closes at 06:45 UTC, the evening before in Los Angeles), 217198 (closes June 2031), 217104 (closes November 2031), 30751 (a practice listing closing in 2037), 229205 (marked "Open", titled "\*CANCELLED\*", no closing date) |
| `detail-232376` | the row with that id | whole answer |
| `detail-unknown` | id 1 | whole answer: an empty list |
