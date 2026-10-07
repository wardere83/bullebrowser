// English, and the source of truth for which keys exist. Every other language
// file is typed against this one, so a missing or extra key fails the build.
//
// Key grammar: <area>.<part>.<role>, where roles are eyebrow, h1/h2/h3, sub,
// body, and .t / .d for a card's title and description.
//
// Three things read the same in every language and are never translated:
// product and vendor names (BulleBrowser, Bulle Consulting), names the app
// shows on screen (lib/terms.ts keeps those), and the acronym "CBOs" (singular
// "CBO"), which is always written as the acronym.

export const en = {
  'app.eyebrow': 'About the app',
  'app.value.h2': 'Bring your research and your evidence together.',
  'app.value.body':
    'Funding strategy starts with understanding what your organization wants to achieve and which opportunities support it. Keep your sources and your priorities close as you explore the next step.',
  'app.overview':
    'BulleBrowser is a desktop app for macOS, Windows and Linux. It brings browsing, your organization’s documents and an optional connected assistant into one place, so you can research funding with your own goals in view.',
  'app.benefit.context.t': 'Put funding in context',
  'app.benefit.context.d':
    'Read official funding pages alongside your mission, plans and documented results. Connect what a funder is asking for with what your organization actually does.',
  'app.benefit.focus.t': 'Decide where to focus',
  'app.benefit.focus.d':
    'Compare priorities, requirements and deadlines with your own goals. Identify questions and evidence gaps before committing time to an application.',
  'app.benefit.strengths.t': 'Prepare from your real strengths',
  'app.benefit.strengths.d':
    'Use approved organization evidence, cited findings and reflective guidance to plan a proposal in your own words.',
  'app.audiences.eyebrow': 'For businesses and CBOs',
  'app.audiences.h2': 'Different goals. A strategy rooted in your work.',
  'app.audiences.body':
    'Start from your organization’s priorities and assess opportunities on their own terms. The app supports your research; the funding decision stays with you and the funder.',
  'app.audience.businesses.t': 'For businesses',
  'app.audience.businesses.d':
    'Bring growth plans, budgets and evidence of your capabilities into funding research. Understand which opportunities deserve attention and what you need to demonstrate before preparing an application.',
  'app.audience.cbos.t': 'For CBOs',
  'app.audience.cbos.d':
    'Keep your mission, programs and documented impact at the center of funding decisions. Explore opportunities that support your priorities and explain your strengths through evidence you can trace.',
  'app.control.eyebrow': 'You stay in control',
  'app.control.h2': 'Your evidence. Your judgment.',
  'app.control.body':
    'Review the evidence behind each finding and approve statements about your organization. You choose what to pursue and write your own proposals; BulleBrowser provides structure and feedback while you remain responsible for decisions and submissions.',
  'app.assistant':
    'Written AI analysis requires your own provider key. Without one, you can still browse, search funding sources and find text in your documents.',

  // Navigation. The section names are used only when components/sections.ts
  // says to translate them; the rest of this block is always in use.
  'nav.home': 'Home',
  'nav.app': 'About the app',
  'nav.guides': 'Guides',
  'nav.download': 'Download',
  'nav.about': 'About',
  'nav.privacy': 'Privacy',
  'nav.skip': 'Skip to main content',
  'nav.main': 'Main',
  'nav.footer': 'Footer',
  'nav.menu.open': 'Open menu',
  'nav.menu.close': 'Close menu',
  'footer.tagline': 'The strategic funding platform for businesses and CBOs.',
  'footer.rights': 'All rights reserved.',

  // Shared
  'common.illustration': 'Illustration — sample data, not a live listing',
  'common.disclaimer':
    'BulleBrowser offers educational support. It is not legal, financial or eligibility advice, and the funder decides who is eligible and who is funded.',
  'cta.download': 'Download BulleBrowser',

  // Coverage levels
  'level.city': 'Citywide',
  'level.county': 'Countywide',
  'level.state': 'Statewide',
  'level.federal': 'Federal',
  'level.international': 'International',

  // Listing status. The descriptions restate the app's one status rule.
  'status.heading': 'What the three labels mean',
  'status.active': 'Active',
  'status.expired': 'Expired',
  'status.unverified': 'Unverified',
  'status.active.d':
    'Shown only when the official source reports the opportunity open and its deadline has not passed, checked when you search.',
  'status.expired.d':
    'The official source reports the opportunity closed, or its deadline has passed.',
  'status.unverified.d':
    'Everything else, such as a forecast, a missing or implausible deadline, a check that failed, or a result that is no longer fresh. Confirm it on the official listing.',

  // Alignment findings
  'finding.documented': 'Documented',
  'finding.partial': 'Partly documented',
  'finding.missing': 'Not in the documents',

  // Home: hero
  'home.badge': 'Funding strategy · By Bulle Consulting',
  'home.h1': 'The strategic funding platform for businesses and CBOs.',
  'home.sub':
    'Move from scattered funding research to a strategy grounded in your organization. BulleBrowser keeps official sources, your documents and a built-in assistant together, so businesses and CBOs can make more informed funding decisions.',
  'home.cta.app': 'Explore the app',
  'home.pill.sources': 'Official sources',
  'home.pill.status': 'Active, Expired or Unverified',
  'home.pill.citations': 'Page and section citations',
  'home.pill.device': 'Stored on your device',
  'marquee.label': 'What BulleBrowser covers',
  'marquee.pause': 'Pause the moving list',
  'marquee.play': 'Resume the moving list',

  // The film. The description is what a screen reader hears in place of it.
  'film.title': 'See your funding strategy take shape.',
  'film.caption':
    'Illustrative walkthrough: the organization, funders, opportunities, amounts and dates are fictional.',
  'film.play': 'Play the BulleBrowser film',
  'film.pause': 'Pause the film',
  'film.fallback': 'The film could not load. Try refreshing the page.',
  'film.description':
    'A silent funding strategy walkthrough using fictional data. An organization adds documents and approves evidence about its priorities. The film shows the app’s four funding actions, official-source opportunity statuses, requirements compared with organization evidence, and reflective questions for a proposal the applicant writes.',

  // The four options. Their names are in lib/terms.ts.
  'ask.eyebrow': 'Four ways to start',
  'ask.h2': 'What can I help you with?',
  'ask.body':
    'BulleBrowser opens with four options. Each is a guided workflow grounded in official sources and in your organization’s own documents.',
  'ask.more': 'How each workflow works',
  'ask.find.lede': 'Search official sources, filtered to your organization.',
  'ask.find.body':
    'Set geography, eligibility, funding category, award amount and deadline, or start from your approved priorities. Every listing links to its official page and is labelled Active, Expired or Unverified.',
  'ask.align.lede': 'See how your documents line up with one opportunity.',
  'ask.align.body':
    'BulleBrowser takes the funder’s requirements one at a time and shows what your documents say about each: documented, partly documented, a gap, or not in the documents. It never tells you that you are or are not eligible.',
  'ask.priorities.lede': 'Understand what a funder is investing in.',
  'ask.priorities.body':
    'Upload an RFP or open a saved listing and read a plain-language summary of the funder’s purpose, priorities, intended outcomes and evaluation criteria, each point cited to its page or section.',
  'ask.guide.lede': 'Write your own proposal, with structure and honest feedback.',
  'ask.guide.body':
    'Work from an outline that follows the funder’s criteria, answer reflective questions, and get observations on your draft. The guide builds on strengths your documents show, and it does not write the proposal for you.',

  // Organization Knowledge Hub. `hub.description` is fixed wording.
  'hub.eyebrow': 'Your organization, in its own words',
  'hub.description':
    'Upload your organization’s documents so BulleBrowser aligns its guidance with your mission, priorities, strengths, and funding goals.',
  'hub.more': 'How the Organization Knowledge Hub works',
  'hub.formats.t': 'PDF, DOCX, TXT and Markdown',
  'hub.formats.d':
    'Add strategic plans, organizational profiles, program descriptions, impact reports, budgets and previous proposals.',
  'hub.review.t': 'You review and approve the profile',
  'hub.review.d':
    'BulleBrowser shows you the profile it extracted from your documents. A statement is used for guidance only after a person approves it.',
  'hub.flag.t': 'Flagged, not guessed',
  'hub.flag.d':
    'Where your documents leave something out or disagree with each other, BulleBrowser says so and leaves the decision to you.',
  'hub.cite.t': 'Every statement cites its source',
  'hub.cite.d':
    'Each statement BulleBrowser proposes points to the document it came from, with the page or section and the passage itself.',
  'hub.priorities.t': 'An editable “Our Priorities” area',
  'hub.priorities.d':
    'Keep your confirmed priorities in one place, change them at any time, and see each one’s sources and the date it was last updated.',
  'hub.separate.t': 'Each organization is kept separate',
  'hub.separate.d':
    'Every organization you add has its own documents, profile and funding work on your device. Nothing is looked up across organizations.',
  'hub.how.h3': 'From documents to an approved profile',
  'hub.how.1': 'Add PDF, DOCX, TXT or Markdown files of up to 40 MB each.',
  'hub.how.2':
    'BulleBrowser reads them on your device and makes them searchable for that organization only.',
  'hub.how.3':
    'It proposes statements about your mission, the people you serve, where you work, your priorities, programs, strengths, impact evidence, capacity and funding goals, each with the passage it came from.',
  'hub.how.4':
    'You approve, edit or reject each one. If a source document is replaced or deleted, the statements that relied on it come back to you for review.',
  'hub.how.note':
    'Proposed statements are written by a connected assistant from cited passages. Without one, BulleBrowser offers exact passages from your documents instead.',
  'hub.sample.mission.field': 'Mission',
  'hub.sample.mission.state': 'Proposed',
  'hub.sample.mission.text':
    'Strengthen resident leadership through community empowerment programs in New Jersey and Los Angeles.',
  'hub.sample.mission.source': 'Strategic plan, page 4',
  'hub.sample.served.field': 'Populations served',
  'hub.sample.served.state': 'Conflict',
  'hub.sample.served.note':
    'Two documents disagree. BulleBrowser does not choose between them; you decide which is correct.',
  'hub.sample.served.a': '“1,200 residents a year”',
  'hub.sample.served.a.source': 'Impact report, page 2',
  'hub.sample.served.b': '“about 900 residents a year”',
  'hub.sample.served.b.source': 'Previous proposal, page 7',
  'hub.sample.goals.field': 'Funding goals',
  'hub.sample.goals.state': 'Missing',
  'hub.sample.goals.note':
    'Not found in your documents. Add them yourself, or upload a document that states them.',
  'hub.sample.approve': 'Approve',
  'hub.sample.edit': 'Edit',
  'hub.sample.reject': 'Reject',

  // The walk-through. Everything in it is sample data and says so.
  'demo.eyebrow': 'Illustration',
  'demo.h2': 'From a question to a cited answer.',
  'demo.body':
    'A walk-through with sample data: a search across official sources, then a look at how one opportunity lines up with the organization’s approved profile.',
  'demo.caption':
    'The organization, funders, listings, amounts and deadlines above are fictional. In the app, listings are read from official sources and link to the official page.',
  'demo.pause': 'Pause',
  'demo.play': 'Play',
  'demo.replay': 'Replay',
  'demo.description':
    'An animated illustration with sample data. A person chooses “Find Relevant Grant Opportunities” and asks for grants for a community empowerment project in New Jersey and Los Angeles. BulleBrowser reads the organization’s approved priorities, searches official sources and checks each deadline, then lists three sample listings: one labelled Active, one labelled Unverified because it is a forecast with no deadline yet, and one labelled Expired. The person then asks how the organization aligns with the first listing. BulleBrowser compares three requirements with the organization’s documents: one is documented, one is partly documented, and one is not in the documents. It notes that the funder decides eligibility.',
  'demo.panel.intro':
    'Guidance here is grounded in your organization’s approved profile and the funding documents you add.',
  'demo.composer': 'Ask in your own words',
  'demo.filter.place': 'New Jersey · Los Angeles',
  'demo.filter.applicant': 'CBOs and other nonprofits',
  'demo.filter.category': 'Community development',
  'demo.listing.a.title': 'Sample listing A: neighborhood leadership grant',
  'demo.listing.a.funder': 'Sample state agency',
  'demo.listing.a.meta': 'Up to $150,000 · closes in 6 weeks',
  'demo.listing.a.reason': 'Open at the source, and the deadline has not passed.',
  'demo.listing.b.title': 'Sample listing B: community partnerships fund',
  'demo.listing.b.funder': 'Sample federal agency',
  'demo.listing.b.meta': 'Amount not stated · no deadline yet',
  'demo.listing.b.reason': 'A forecast: the source has not published a deadline.',
  'demo.listing.c.title': 'Sample listing C: resident programs grant',
  'demo.listing.c.funder': 'Sample city agency',
  'demo.listing.c.meta': 'Up to $50,000 · closed',
  'demo.listing.c.reason': 'The deadline has passed.',
  'demo.listing.link': 'Official listing',
  'demo.prompt1': 'Find grants for our community empowerment project in New Jersey and Los Angeles',
  'demo.step.profile': 'Reading your approved priorities',
  'demo.step.search': 'Searching official sources',
  'demo.step.deadlines': 'Checking each deadline',
  'demo.answer1':
    'I found three sample listings. One is active. One is unverified, because it is a forecast with no deadline yet. One has expired. Open each official listing to confirm the details.',
  'demo.prompt2': 'How do we align with sample listing A?',
  'demo.step.notice': 'Reading the funding notice',
  'demo.step.documents': 'Reading your approved profile',
  'demo.step.compare': 'Comparing one requirement at a time',
  'demo.answer2':
    'Your documents show one requirement in full and one in part. Nothing in them mentions a letter of support, so that is a question to settle. The funder decides who is eligible; this shows only what your documents say.',
  'demo.align.title': 'Alignment with sample listing A',
  'demo.align.funder': 'The funder asks',
  'demo.align.yours': 'Your documents',
  'demo.align.r1.req': 'Serves residents of New Jersey or Los Angeles',
  'demo.align.r1.src': 'Funding notice, page 3',
  'demo.align.r1.org': 'Strategic plan, page 4',
  'demo.align.r2.req': 'Two years of program results',
  'demo.align.r2.src': 'Funding notice, page 5',
  'demo.align.r2.org': 'Impact report, page 2: one year',
  'demo.align.r3.req': 'A letter of support from a local partner',
  'demo.align.r3.src': 'Funding notice, page 6',
  'demo.align.r3.org': 'Nothing found',

  // Funding opportunity finder. The sources are listed in lib/terms.ts.
  'finder.eyebrow': 'Funding opportunity finder',
  'finder.h2': 'Citywide to international, read from official sources.',
  'finder.body':
    'Search citywide, countywide, statewide, federal and international funding opportunities, and filter by geography, eligibility, funding category, award amount and deadline. Every listing is read from an official source, links to the official listing, and is labelled Active, Expired or Unverified.',
  'finder.more': 'Sources and coverage',
  'finder.levels.h3': 'Five levels of coverage',
  'finder.filters.h3': 'Filters',
  'filter.geography': 'Geography',
  'filter.eligibility': 'Eligibility',
  'filter.category': 'Funding category',
  'filter.amount': 'Award amount',
  'filter.deadline': 'Deadline',
  'finder.sources.h3': 'Live sources today',
  'finder.sources.body':
    'When you search, BulleBrowser reads these official sources directly from your device.',
  'finder.sources.caption': 'Official sources BulleBrowser reads today',
  'finder.col.source': 'Official source',
  'finder.col.level': 'Level',
  'finder.col.lists': 'What it lists',
  'source.grants.d': 'United States federal grant opportunities',
  'source.california.d': 'California state grants',
  'source.local.d': 'Open-data feed of solicitations: requests for proposals and bids',
  'source.eu.d': 'European Union funding opportunities',
  'finder.sources.note':
    'The city and county sources publish solicitations, which BulleBrowser labels as contract solicitations rather than grants.',
  'finder.portals.t': 'A directory of official portals for everywhere else',
  'finder.portals.d':
    'For other jurisdictions, BulleBrowser keeps a directory of official funding portals. They are shown as links to the official site, not as listings.',
  'finder.coverage':
    'Coverage is not complete. Most states, counties and cities are not live sources yet, and BulleBrowser does not fill the gap with unofficial listings.',

  // RFP upload and analysis
  'rfp.eyebrow': 'RFP upload and analysis',
  'rfp.h2': 'Read what a funder is asking for, with the page it comes from.',
  'rfp.body':
    'Upload an RFP and BulleBrowser gives you an educational summary of the funder’s purpose, priorities and intended outcomes. Every point is cited to its page or section, and explicit requirements are kept apart from interpretation.',
  'rfp.more': 'What the analysis covers',
  'rfp.covers.h3': 'What the summary covers',
  'rfp.cover.purpose.t': 'Purpose, priorities and outcomes',
  'rfp.cover.purpose.d':
    'What the funder is investing in, what it prioritizes and the outcomes it intends.',
  'rfp.cover.eligibility.t': 'Eligibility and supported activities',
  'rfp.cover.eligibility.d':
    'Who may apply, and which activities and expenses the funding supports.',
  'rfp.cover.terms.t': 'Amounts, match, period and deadlines',
  'rfp.cover.terms.d':
    'Award amounts, matching requirements, the funding period and each deadline the document states.',
  'rfp.cover.process.t': 'Criteria, documents, submission and reporting',
  'rfp.cover.process.d':
    'How applications are evaluated, which documents are required, the submission steps and the reporting obligations.',
  'rfp.cover.alignment.t': 'Alignment with your approved priorities',
  'rfp.cover.alignment.d':
    'Where the funder’s requirements meet what your approved profile and documents show.',
  'rfp.cover.gaps.t': 'Gaps and questions to resolve',
  'rfp.cover.gaps.d':
    'What the document leaves unclear or does not cover, and the questions to settle before you apply.',
  'rfp.rules.h3': 'How the analysis is kept honest',
  'rfp.rule.cite': 'Every point cites the page or section it comes from.',
  'rfp.rule.split': 'Explicit requirements are marked apart from interpretation.',
  'rfp.rule.missing': 'Where the document is silent or unclear, the summary says so.',
  'rfp.rule.profile':
    'An uploaded RFP never changes your organization’s profile. It is kept apart from the Organization Knowledge Hub.',
  'rfp.rule.assistant':
    'The written summary needs a connected assistant. Without one, BulleBrowser lists the dates, amounts and requirements it finds in the text, each with its citation.',

  // Ethical Strengths-Based Proposal Guide
  'guide.eyebrow': 'Ethical proposal development',
  'guide.body':
    'Structure, reflective questions, outlines and feedback, so that you write your own proposal from verified strengths and evidence.',
  'guide.more': 'What the guide will and will not do',
  'guide.rule.own.t': 'You write it',
  'guide.rule.own.d':
    'The guide offers structure, reflective questions, outlines and feedback. It does not write proposal text for you to submit, even when asked.',
  'guide.rule.strengths.t': 'Built on verified strengths',
  'guide.rule.strengths.d':
    'Each section starts from what your approved profile and documents show you do well, with citations.',
  'guide.rule.invent.t': 'Nothing invented',
  'guide.rule.invent.d':
    'It never invents outcomes, partnerships, credentials, eligibility or figures. A number, name or result appears only when a cited source states it.',
  'guide.rule.ai.t': 'Follows the funder’s rules on AI assistance',
  'guide.rule.ai.d':
    'The guide looks for the funder’s rules on AI tools first. If the funder restricts or prohibits them, it offers reflective questions and checklists only. If the rules say nothing, it tells you so and suggests confirming with the funder.',
  'guide.rule.feedback.t': 'Observations, not rewrites',
  'guide.rule.feedback.d':
    'Share a draft and the guide tells you what is strong, what is unclear and which claims your documents do not support, quoting your own words.',
  'guide.rule.owner.t': 'You own what you submit',
  'guide.rule.owner.d':
    'The applicant owns the proposal and is accountable for everything in it. Check each fact, figure and requirement against its source before you send it.',

  // Browser and assistant
  'browser.eyebrow': 'Browser and assistant',
  'browser.h2': 'A full browser, with an assistant that asks first.',
  'browser.body':
    'BulleBrowser is a desktop browser with tabs, bookmarks and history. Its built-in assistant can read pages and browse official sites for you, and it stays under your control.',
  'browser.access.t': 'Asks before it browses',
  'browser.access.d':
    'Each task asks once for permission to use your tabs, and says what it wants to do.',
  'browser.steps.t': 'Shows every step',
  'browser.steps.d': 'You see each step as it happens, and Stop halts the task.',
  'browser.budget.t': 'Works within a step budget',
  'browser.budget.d':
    'Every browsing task has a step budget. It stops at the limit, and you decide whether it continues.',
  'browser.confirm.t': 'Confirms before consequential actions',
  'browser.confirm.d':
    'Submitting a form, sending, paying, deleting, uploading or publishing needs your confirmation first. Typing into password and payment fields is blocked.',
  'browser.voice.t': 'Speak instead of typing',
  'browser.voice.d':
    'Voice input transcribes English on your device. The speech model downloads the first time you use it.',
  'browser.assistant.t': 'An assistant is optional',
  'browser.assistant.d':
    'Written analysis needs your own AI provider key. Without one, the funding finder, document search and text matches in funding documents still work.',

  // Privacy, in brief. The policy itself is app/privacy/page.tsx.
  'privacy.eyebrow': 'Privacy',
  'privacy.h2': 'Stored on your device. Sent only where you direct it.',
  'privacy.body':
    'Documents, extracted text, your profile and your analyses are stored on your device. When you connect your own AI provider and ask for analysis, relevant document excerpts go directly to that provider under your own key. Funding searches send search terms and filters, never documents, directly to the official sources. Nothing is routed through Bulle Consulting, and there is no analytics or telemetry.',
  'privacy.1':
    'Documents, extracted text, your profile and your analyses are stored on your device.',
  'privacy.2':
    'When you connect your own AI provider and ask for analysis, relevant document excerpts go directly to that provider under your own key.',
  'privacy.3':
    'Funding searches send search terms and filters, never documents, directly to the official sources.',
  'privacy.4': 'Nothing is routed through Bulle Consulting.',
  'privacy.5': 'Keys are encrypted and stored on this device.',
  'privacy.6': 'No analytics. No telemetry.',
  'privacy.more': 'Read the privacy policy',
  'privacy.english': 'The privacy policy is published in English.',

  // About the app page
  'features.h1': 'A browser built for your funding strategy.',
  'features.sub':
    'Bring web research and your organization’s evidence into one place. BulleBrowser helps businesses and CBOs understand their options, decide where to focus and prepare with confidence in their sources.',
  'features.cta.h2': 'Build your next funding decision on evidence.',
  'features.cta.sub': 'Available for macOS, Windows and Linux.',

  // Download page
  'download.h1': 'Download BulleBrowser',
  'download.sub':
    'Installers for the current release of BulleBrowser, the strategic funding platform for businesses and CBOs. It is a desktop app for macOS, Windows and Linux.',
  'download.signed':
    'macOS releases are signed with a Developer ID and notarized by Apple. On Windows, SmartScreen may ask you to confirm before the installer runs.',
  'download.checking': 'Checking for the latest release…',
  'download.unavailableNow':
    'The release list could not be loaded right now. Try again in a few minutes.',
  'download.latest': 'Latest release:',
  'download.published': 'published',
  'download.none': 'No public release has been published yet.',
  'download.caption': 'BulleBrowser installers by platform',
  'download.col.platform': 'Platform',
  'download.col.requirements': 'Requirements',
  'download.col.size': 'Size',
  'download.col.version': 'Version',
  'download.col.action': 'Installer',
  'download.req.mac': 'macOS 12 or newer',
  'download.req.win': 'Windows 10 or newer',
  'download.req.winArm': 'Windows 11 on ARM',
  'download.req.linux': 'glibc 2.31 or newer',
  'download.action': 'Download',
  'download.unavailable': 'Not available',
  'download.guide': 'Installation and first-run guide',
  'download.checksums': 'SHA-256 checksums',
  'download.releases': 'All releases on GitHub',

  // Guides page. Names in quotation marks are the app's own labels.
  'install.h1': 'Install BulleBrowser and set up your organization',
  'install.sub':
    'From download to your first funding search in a few minutes. No technical background needed.',
  'install.s1.t': 'Install the app',
  'install.s1.mac':
    'Open the .dmg, drag BulleBrowser into Applications, then open it. Releases are signed and notarized by Apple, so it opens normally.',
  'install.s1.win':
    'Run the .exe installer. If SmartScreen appears, choose “More info”, then “Run anyway”.',
  'install.s1.linux': 'Make the AppImage executable, then run it:',
  'install.s2.t': 'Create your organization',
  'install.s2.d':
    'On first launch, BulleBrowser asks for your organization’s name, whether it is a business or a CBO, and where it is based. The location is used to find citywide, countywide and statewide funding for you, and it is stored on your device. You can add more organizations later; each one is kept separate.',
  'install.s3.t': 'Add documents to the Organization Knowledge Hub',
  'install.s3.d':
    'Add PDF, DOCX, TXT or Markdown files of up to 40 MB each: strategic plans, organizational profiles, program descriptions, impact reports, budgets and previous proposals. BulleBrowser reads them on your device.',
  'install.s4.t': 'Review and approve your profile',
  'install.s4.d':
    'BulleBrowser proposes statements about your organization, each with the passage it came from, and flags anything missing or conflicting. Approve, edit or reject each one. Only approved statements are used for guidance.',
  'install.s5.t': 'Connect an assistant (optional)',
  'install.s5.d':
    'Written analysis — proposed profile statements, summaries of funding documents, alignment assessments and proposal guides — needs your own AI provider key. Open the profile menu, choose “Settings”, then “Connect an assistant (optional)”, paste your key and save. Keys are encrypted and stored on this device. Without a key, the funding finder, document search and text matches in funding documents still work.',
  'install.s6.t': 'Choose where to start',
  'install.s6.d':
    'Open “Your Assistant” and pick one of the four options under “What can I help you with?”, or ask in your own words.',
  'install.note.t': 'About the security prompts',
  'install.note.d':
    'macOS releases are signed with a Developer ID and notarized by Apple. On Windows, SmartScreen can show a prompt before a newly published installer runs. Each release includes a SHA-256 checksum file, linked from the download page.',
  'install.updates.t': 'Updates',
  'install.updates.d':
    'BulleBrowser checks for published releases when it starts and every five minutes, then downloads updates in the background. Choose “Update App” to keep working and hide the notice for that version. The update takes effect after you quit normally and open the app again. A newer release brings the notice back. On macOS, one update is prepared at a time; a newer download waits until the prepared version takes effect.',
  'install.next': 'Explore the app',

  // About page
  'about.h1': 'About Bulle Consulting',
  'about.lead':
    'Bulle Consulting built BulleBrowser as a strategic funding platform for businesses and CBOs. It helps them discover funding opportunities, understand funder priorities, assess their alignment and develop proposals ethically.',
  'about.why.h2': 'Why a browser?',
  'about.why.p':
    'Funding work happens on the web: official portals, funder sites, notices and application systems. A browser with a built-in assistant can read those official sources directly and keep your organization’s documents beside them, on your device.',
  'about.limits.h2': 'What BulleBrowser will not do',
  'about.limits.p':
    'It does not write proposals for you, it does not invent facts about your organization, and it does not call a listing active unless an official source says it is open and its deadline has not passed. It gives structure, citations and honest labels, and leaves the judgment and the writing to you.',
  'about.key.h2': 'Why your own key?',
  'about.key.p':
    'Organizations work with sensitive material: plans, budgets and drafts. We do not want it on our servers. BulleBrowser stores your documents on your device and, when you ask for written analysis, sends the relevant excerpts directly to the AI provider you connect, under your own key. Nothing is routed through Bulle Consulting.',
  'about.contact.h2': 'Contact',
  'about.contact.p': 'Press, partnerships or product feedback:',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
