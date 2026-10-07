# Funding rebuild

BulleBrowser now centers funding strategies for businesses and CBOs across the website and desktop app. The assistant and dashboard show the four requested actions exactly:

1. Find Relevant Grant Opportunities
2. Assess Our Funding Alignment
3. Explore Funder Priorities
4. Ethical Strengths-Based Proposal Guide

## Delivered workflows

- Official-source discovery with geographic funding levels, recipient-location filters, eligibility, categories, amounts and deadlines; sourced facts, relevance explanations and Active / Expired / Unverified statuses.
- Organization Knowledge Hub in onboarding and navigation. PDF, DOCX, TXT and Markdown extraction, processing status, extracted-text inspection, document categorization, replacement, retry, deletion and passage search.
- Persistent device-local organization identities and roles, separate storage and indexes, approved profiles, document citations, gap/conflict review and editable Our Priorities. Additions and edits require explicit approval, including for owners.
- RFP uploads and supported official listing links; educational analysis of all thirteen requirement categories, glossary, literal dates and amounts, AI policies, uncertainty and amendment precedence instructions.
- Alignment against approved organization statements and supporting documents; cited requirements, documented strengths, gaps and unresolved questions without invented scores.
- Ethical proposal guidance with reflective questions, evidence checklists, outlines and comments on user-authored writing. Restricted policies prevent tailored model calls and draft feedback.
- Changed or deleted evidence invalidates affected claims and historical alignment/guidance; saved reports require refresh before being used as current advice.
- Funding website copy in English, French, Arabic, Spanish and Portuguese; all translation keys match. Product illustrations are labelled fictional. The funding product film has been regenerated.

## Operating limits

Authentication follows the existing device-local identity and organization access controls; this release does not introduce hosted accounts or cross-device team synchronization.

Without a connected assistant, the app reads and searches documents, proposes verbatim profile passages, identifies literal RFP findings and provides standard reflective guides. Educational interpretation, alignment judgements and draft feedback require an assistant key and organization consent.

Live discovery connects to Grants.gov, California Grants Portal, NYC City Record, LA RAMP, Montgomery County and the EU funding portal. Other official portals are offered as explicit links. Direct RFP link import recognizes Grants.gov, California, NYC and EU topic notices; other notices can be uploaded. A source failure is shown as a failure, never as a verified listing.

Uploaded notices cannot independently establish whether an unprovided later amendment exists. The app labels uncertain or conflicting requirements and asks for review; current requirements are used only when the provided source establishes precedence. Related notices and amendments can be uploaded and selected for reading.

## Validation

The acceptance suite runs the real Electron app with isolated temporary user data. It checks the exact four actions, document inspection and search, explicit approval, restart persistence, organization separation, keyless RFP analysis and alignment, official link import using recorded source responses, structured assistant analysis with verified citations, enforcement of a prohibited AI policy, failed/scanned uploads and removal of deleted evidence from search and guidance.

Unit tests also cover organization RPC authorization, path separation, safe extraction, quote verification, deadline/status handling, official adapters, profile approval/replacement, RFP citation rejection and ethical-guide restrictions. Browser checks cover all six public site pages at desktop and mobile widths. CI remains the release gate for platform builds; deployment and signed installers are verified separately after publication.
