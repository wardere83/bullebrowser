# California Grants Portal recorded answers

Real answers from the "Grants Offered" dataset of the California Grants Portal
on the State of California open-data portal, used by
`src/main/opportunities/sources/ca-grants-portal.test.ts`. No test calls the
network.

- **Recorded on:** 6 October 2026, at about 12:32 UTC.
- **Service:** `GET https://data.ca.gov/api/3/action/datastore_search`, dataset
  `111c8c88-21f6-453c-ae2c-b4785a0624f5`. It needs no key.
- **How:** by running the adapter itself against the live service, so each
  request is exactly the one the adapter builds.

Each file holds the request that was sent and the answer as it came back,
apart from what was removed (see below):

```json
{ "recordedOn": "2026-10-06", "request": { "url": "…" }, "response": { … } }
```

Listings change daily. These files describe that one day and are not expected
to match the live service later.

## What was removed

No listing was added or reworded.

- **Rows.** The search answers were cut down to the few listings named below
  (the live answers held 166, 169 and 300), and `total` in each was lowered to
  the number of rows kept so that the answer still agrees with itself. The
  `_links` the service returned were left as they came.
- **Named staff.** `ContactInfo` was emptied (set to `null`, as the service
  itself writes an empty field) in listings 190254, 192057 and 171777, where it
  named an individual member of agency staff. `Description` was emptied in
  190254 for the same reason. Contacts that name an office or a shared mailbox
  were kept.

## Searches

| File | Request | Rows kept |
| --- | --- | --- |
| `search-active` | status `active`, limit 1000 | 191046 (complete; deadline 2 Nov 2026), 192465 (award "Between $1.00 and $750,000.00"), 190254 (still `active` a day after its deadline of 5 Oct 2026; a single award figure), 152751 (sparse; deadline at midnight), 117471 (grant and loan; deadline "Ongoing"), 3300 (loan; "Ongoing"; no total stated) |
| `search-active-and-forecasted` | status `active` or `forecasted`, limit 1000 | 191046, and the three forecasts that day: 192057 (opens "October 1, 2026"), 190194 (opens "2027"), 171777 (opens "September 2026"), none with a deadline |
| `search-closed` | status `closed`, sorted `ApplicationDeadline desc`, limit 300 | the two most recently closed: 190497 and 173037 |

## Listings

| File | Listing | Why it is here |
| --- | --- | --- |
| `detail-191046` | The Recreational Trails Program (RTP) – R27 | whole answer; matching funds with a note, an online application link, an office contact |
| `detail-unknown` | id 999999999 | whole answer: success, no rows, total 0 |
