# Grants.gov recorded answers

Real answers from the public Grants.gov services, used by
`src/main/opportunities/sources/grants-gov.test.ts`. No test calls the network.

- **Recorded on:** 6 October 2026, between 11:15 and 12:06 UTC.
- **Services:** `POST https://api.grants.gov/v1/api/search2` and
  `POST https://api.grants.gov/v1/api/fetchOpportunity`. Neither needs a key.
- **Every answer came back with HTTP 200**, including the failures. That is the
  point of several of them.

Each file holds the request that was sent and the answer exactly as it came
back, apart from what was removed (see below):

```json
{ "recordedOn": "2026-10-06", "request": { "url": "…", "body": { … } }, "response": { … } }
```

Listings change daily. These files describe that one day and are not expected to
match the live service later.

## What was removed

Nothing was added or reworded, and no rows were dropped. Keys were removed, and
that is all:

- `token` from every answer (a short-lived session value).
- From three search answers, the facet lists the adapter never reads
  (`eligibilities`, `fundingCategories`, `fundingInstruments`, `agencies`,
  `dateRangeOptions`): `search-infrastructure-open`, `search-human-services` and
  `search-algerian-closed`. The other search answers are whole.
- From every listing record, the parts the adapter never reads:
  `opportunityHistoryDetails`, `synopsisAttachmentFolders`, `opportunityPkgs`,
  `closedOpportunityPkgs`, `relatedOpps` and `publisherUid` (the publishing
  account's user name).
- Contact fields that name an individual member of agency staff
  (`agencyContactName`, `agencyContactDesc`, `agencyContactEmail`,
  `agencyContactEmailDesc`, `agencyContactPhone`, `agencyPhone`,
  `agencyAddressDesc`, and `agencyName` inside the synopsis where it held a
  person): removed from the synopsis of 362880, 362893, 363482, 332127 and
  318269 and from the forecast of 359123, 362880 and 355824. Contact fields
  that name an office or a shared mailbox were kept.
- `forecastDesc` from 355824: the funder's description spells out a term this
  product only ever writes as "CBOs".

## Searches

The request bodies are the ones the adapter builds, so a test can check that it
sends exactly what was recorded.

| File | Request | Answer |
| --- | --- | --- |
| `search-oral-health-nonprofit` | keyword `oral AND health`, posted, eligibility `12\|13\|99`, categories `ACA\|HL` | 11 rows |
| `search-infrastructure-open` | keyword `strengthening AND american AND infrastructure`, forecasted and posted | 80 rows: 79 posted (two with no close date, two closing in 2099) and one forecast |
| `search-human-services` | no keyword, posted, category `ISS` | 66 rows, all with a close date |
| `search-algerian-posted` | keyword `algerian AND collaboration`, posted | no rows, and correctly so: the counts show 9 closed and 16 archived matches but none posted |
| `search-algerian-closed` | the same keyword, archived and closed, sorted `closeDate\|desc`, 500 rows | 25 rows, most recently closed first |
| `search-unsupported-sort` | keyword `community health`, posted, sorted `oppTitle\|asc` | **silent failure:** no rows and no error, while the counts show 528 posted matches |
| `search-non-ascii-keyword` | keyword `educación`, posted | **silent failure:** success code, no rows, no counts and no echo of the search |

The last two were sent by hand to capture the failure; the adapter never sends
either request.

## Listing records

| File | Listing | Why it is here |
| --- | --- | --- |
| `detail-359123` | NIH RFA-DE-27-001, posted, closes 19 Oct 2026 | first row of the oral-health search; award ceiling and floor are the word "none"; office contact |
| `detail-362880` | HUD OFH-2600-DC-021A, posted, closes 2 Nov 2026 | amounts stated; coded only "Others"; carries both a synopsis and the forecast it began as |
| `detail-363482` | AmeriCorps AC-08-20-2026, posted, closes 20 Oct 2026 | twelve funding categories with an explanation; a described link to the funder's page |
| `detail-364025` | NSF 25-534, posted the day before, no close date | its close-date note reads "Funding Opportunity is Archived, Proposals are not accepted" |
| `detail-363786` | State Department DFOP0018819, posted | close date 1 Jan 2099; the note says the first round has closed and review is rolling |
| `detail-355211` | State Department OFOP0001473, posted | close date 1 Jan 2099; the close-date note is the literal word "undefined" |
| `detail-279638` | USDA REAP, posted in 2015, no close date | still listed as posted; the note says "accepted year-round" |
| `detail-332127` | Commerce EDA-SEA-TA-SRO-2021-2006853, posted, no close date | "accepted on a continuing basis"; an entity in the title; HTML in the description |
| `detail-362893` | Fish and Wildlife Service F26AS00104, posted, closes 16 Dec 2026 | an open listing whose note says applications "can no longer be accepted" once the closing date has come |
| `detail-364022` | HUD PDR-2700-DC-0054, forecast | estimated due date 11 Mar 2027 |
| `detail-355824` | HHS MP-CPI-25-001, forecast | still a forecast although its estimated due date was 23 Jun 2025; its description was removed (see above) |
| `detail-362903` | State Department OFOP0002813, closed | second row of the closed search; estimated funding is "0" |
| `detail-318269` | SBA ONAA-7J-2019-01, archived | coded "Unrestricted" |
| `detail-unknown-id` | id 999999999 | no record: no `id`, and "There is no record found for your search." in `errorMessages` |
| `detail-backend-unavailable` | a request with a non-numeric id | the service reporting that its own back end did not answer |
