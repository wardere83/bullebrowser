# EU Funding & Tenders Portal recorded answers

Real answers from the search service behind the European Commission's Funding
& Tenders Portal, used by
`src/main/opportunities/sources/eu-funding-tenders.test.ts`. No test calls the
network.

- **Recorded on:** 6 October 2026, between 12:35 and 12:39 UTC.
- **Service:** `POST https://api.tech.ec.europa.eu/search-api/prod/rest/search`
  with the public key `SEDIA` and four form parts, each typed as JSON:
  `query`, `languages`, `sort` and `displayFields`.
- **How:** by running the adapter itself against the live service, so each
  request is exactly the one the adapter builds.
- **Licence:** © European Union, reused under CC BY 4.0.

Each file holds the request that was sent, with its form parts written out as
JSON, and the answer as it came back, apart from what was removed (see below):

```json
{ "recordedOn": "2026-10-06", "request": { "url": "…", "form": { … } }, "response": { … } }
```

Listings change daily. These files describe that one day and are not expected
to match the live service later.

## What was removed

Rows, and nothing else. The search answers were cut down to the few records
named below, and `totalResults` in each was lowered to the number of records
kept so that the answer still agrees with itself. Later pages were not kept.
No record was added or reworded, and no field was removed from a record that
was kept. The fields that were asked for name no individuals.

## Searches

Each asks for current records (`DATASOURCE` `SEDIA`) of one record type: 1 is a
grant topic, 2 an external-action call, 8 a cascade-funding call.

| File | Request | Records kept (live count) |
| --- | --- | --- |
| `open-topics` | type 1, open, a deadline on or after 6 Oct 2026, sorted by `identifier` | 4 of 136: CREA-MEDIA-2027-FILMOVE (two cut-off dates), EUBA-EFSA-2026-PLANTS-02 (opened that day), HORIZON-EIC-2026-DEFENCE-01 (no description), HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP (complete) |
| `open-external` | type 2, the same conditions, sorted by `callIdentifier` | 2 of 14: 186411, and 187027 whose deadline was that day |
| `open-cascade` | type 8, the same conditions, sorted by `callccm2Id` | 3 of 93: 14741, 14841 (one cut-off passed, one to come), 15322 (with a description) |
| `forthcoming-topics` | type 1, forthcoming, opening on or after 6 Oct 2026 | 2 of 295: CREA-MEDIA-2027-FILMDIST, CREA-MEDIA-2027-FILMSALES |
| `forthcoming-external` | type 2, the same conditions | whole answer: none |
| `forthcoming-cascade` | type 8, the same conditions | whole answer: 15342 |
| `closed-latest` | types 1, 2 and 8, closed, sorted by deadline, latest first | 3 of the first 100: LIFE-2026-STRAT-CLIMA-SIP-two-stage (closed, with a second-stage date still to come), cascade calls 15241 and 11264 |

## Listings

All are whole answers.

| File | Listing | Why it is here |
| --- | --- | --- |
| `detail-topic-HORIZON-EIT-2026-PRIZE-WIP-LEADERSHIP` | a prize topic | a budget line with a floor, a ceiling and a year's budget |
| `detail-cascade-14841` | Co-Creation Accelerator 2026-2027 | two cut-off dates; a duration; further information |
| `detail-external-187126` | an external-action call | attached documents |
| `detail-topic-ERASMUS-EDU-2022-ECHE-CERT-FP` | Erasmus Charter for Higher Education | flagged open although its last deadline was 24 March 2026 |
| `detail-unknown` | identifier NO-SUCH-TOPIC-0000 | no records |
