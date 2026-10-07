// The fixed strengths-based structure of a proposal guide.
//
// It is the whole outline when no assistant is connected or the funder limits
// AI assistance, and the skeleton an assistant tailors otherwise. Every word of
// it is written here, by people, and none of it is proposal text: each part
// says what that part of a proposal has to do and asks the writer questions
// that only their own evidence can answer.
//
// The order starts from strengths. The community is described by what it has
// and what it is building; the organization by what it has documented that it
// does well.

import { FUNDING_SCREENS } from '@bullebrowser/agent-core';
import type { ProfileFieldId, RfpSectionId } from '../../shared/funding.js';

export const STANDARD_SECTION_IDS = [
  'community_context',
  'strengths_track_record',
  'project_design',
  'outcomes_measurement',
  'budget_resources',
  'partnerships_capacity',
  'sustainability',
  'attachments_compliance',
] as const;

export type StandardSectionId = (typeof STANDARD_SECTION_IDS)[number];

/**
 * The most any outline may hold, fixed or tailored. Short entries are what
 * keep an outline from turning into text to paste: there is room for a
 * question or a pointer, and none for a paragraph.
 */
export const OUTLINE_LIMITS = {
  heading: 120,
  purpose: 300,
  question: 300,
  why: 300,
  evidenceNote: 200,
} as const;

export interface StandardSection {
  id: StandardSectionId;
  heading: string;
  /** What this part of a proposal needs to do for the reader. */
  purpose: string;
  questions: { text: string; why: string }[];
  /** Profile fields whose approved statements are listed in this part. */
  fields: ProfileFieldId[];
  /** Parts of a funding document's analysis whose items are listed in this part. */
  rfpSections: RfpSectionId[];
  /** Words that place a funder priority or evaluation criterion in this part. */
  keywords: string[];
  /** What to gather when no documented strength is listed in this part. */
  whenNoStrengths: string;
}

export const STANDARD_OUTLINE: readonly StandardSection[] = [
  {
    id: 'community_context',
    heading: 'Community context, told from strengths',
    purpose:
      'Show the reader the community as the people in it know it: what it has, what it is building, and why this work matters to them.',
    questions: [
      {
        text: 'What do the people you serve already do well, and which of your documents shows it?',
        why: 'A picture of a community that starts with its strengths is more accurate, and more convincing, than a list of problems.',
      },
      {
        text: 'Which facts about the place and the people you serve come from a source you can name, and how recent is each one?',
        why: 'A figure with a named, current source can be checked. One without a source weakens everything near it.',
      },
      {
        text: 'What have the people you serve told you they want, and how did you hear it?',
        why: 'Funders look for work that was shaped with the people it is for.',
      },
      {
        text: 'How would someone who lives or works there describe the opportunity this project responds to?',
        why: 'Describing the opportunity in their terms keeps the proposal from defining people by what they lack.',
      },
    ],
    fields: ['mission', 'populations_served', 'geographic_scope'],
    rfpSections: ['purpose'],
    keywords: ['communit\\w*', 'needs?', 'neighborhoods?', 'residents?', 'populations?', 'equit\\w*', 'geograph\\w*', 'underserved'],
    whenNoStrengths:
      'Gather what your documents say about your mission, the people you serve and where, then approve those statements in your profile.',
  },
  {
    id: 'strengths_track_record',
    heading: 'Organizational strengths and track record',
    purpose: 'Show what your organization has already done well, with evidence a reviewer can check.',
    questions: [
      {
        text: 'Which result in your impact report best shows that you can deliver this kind of work?',
        why: 'One well-documented result persuades more than several general claims.',
      },
      {
        text: 'What have you kept going for several years, and which document shows it?',
        why: 'A track record is evidence of capacity that a reviewer does not have to take on trust.',
      },
      {
        text: 'Which of your strengths matters most to this funder, and what in the funding document tells you so?',
        why: 'Leading with the strength the funder is looking for helps a reviewer see the fit.',
      },
      {
        text: 'Where do your documents disagree about a date, a figure or a place, and which one is right?',
        why: 'Reviewers notice inconsistencies. Settling them before you write protects your credibility.',
      },
    ],
    fields: ['strengths', 'impact_evidence'],
    rfpSections: [],
    keywords: ['track record', 'experience\\w*', 'history', 'accomplishments?', 'qualifications?', 'past performance', 'demonstrated'],
    whenNoStrengths:
      'Gather the documents that show your results and strengths, such as impact reports, evaluations or awards, and approve what they show in your profile.',
  },
  {
    id: 'project_design',
    heading: 'Project design and activities',
    purpose: 'Explain what you will do, with whom and when, and why this design fits the people you serve.',
    questions: [
      {
        text: 'Which of your current programs does this project build on, and what would change with this funding?',
        why: 'A project that grows from work you already do well is easier for a reviewer to believe in.',
      },
      {
        text: 'How does this project advance a priority your board has already adopted?',
        why: 'A link to your own strategic plan shows the project is yours and was not shaped only to fit the grant.',
      },
      {
        text: 'Who will carry out each activity, and what in your documents shows they are ready to?',
        why: 'Reviewers look for a design that the named people and partners can actually deliver.',
      },
      {
        text: 'Which activities does the funder say it will and will not pay for, and where does each of yours fall?',
        why: 'An activity the funder does not support can cost points or make a budget line unallowable.',
      },
    ],
    fields: ['programs', 'strategic_priorities'],
    rfpSections: ['supported_activities'],
    keywords: ['design\\w*', 'programs?', 'projects?', 'activit\\w*', 'approach\\w*', 'models?', 'training', 'services?', 'curricul\\w*', 'work ?plan', 'timeline', 'implementation', 'supports?', 'wraparound'],
    whenNoStrengths:
      'Gather your program descriptions and strategic plan, and approve the programs and priorities this project builds on.',
  },
  {
    id: 'outcomes_measurement',
    heading: 'Outcomes and how they will be measured',
    purpose: 'State the change you expect and how you will know it happened, using measures you can really collect.',
    questions: [
      {
        text: 'Which outcomes do you already measure, and how are they recorded today?',
        why: 'Measures you already collect are more credible than measures created for a proposal.',
      },
      {
        text: 'Which result from your past work makes your target for this project realistic?',
        why: 'A target grounded in your own results shows a reviewer that it can be reached.',
      },
      {
        text: 'Who will collect each measure, when, and with what tool?',
        why: 'Reviewers check that an evaluation plan can be carried out with the staff and systems you have.',
      },
      {
        text: "Which of the funder's intended outcomes can you report on today, and which would need a new measure?",
        why: 'Knowing this early keeps you from promising a result you cannot show later.',
      },
    ],
    fields: [],
    rfpSections: ['outcomes'],
    keywords: ['outcomes?', 'evaluat\\w*', 'measur\\w*', 'data', 'results?', 'impact', 'metrics?', 'indicators?', 'tracking'],
    whenNoStrengths:
      'Gather the outcomes you already track and how each is measured, from your impact reports or evaluation records.',
  },
  {
    id: 'budget_resources',
    heading: 'Budget and resources',
    purpose:
      'Show what the work costs, what you are asking for and what else pays for it, in figures that match your documents.',
    questions: [
      {
        text: 'Which figures in your budget come straight from an approved budget or audit, and which are estimates?',
        why: 'Reviewers compare a budget with financial documents. Marking estimates keeps you accountable for both.',
      },
      {
        text: 'What does the funder limit or exclude, and where does each of your costs stand against that?',
        why: "A cost outside the funder's rules can be cut from an award or count against the application.",
      },
      {
        text: 'What other money or in-kind support will go into this project, and is each part committed or only planned?',
        why: 'Funders ask how the whole cost is covered, and a required match usually has to be documented.',
      },
      {
        text: 'How does this request fit the funding goals your organization has already set?',
        why: 'A request that fits your own plan reads as part of a strategy.',
      },
    ],
    fields: ['funding_goals'],
    rfpSections: ['award_amounts', 'matching'],
    // The longer phrase comes first, so "cost effectiveness" counts once.
    keywords: ['budget\\w*', 'cost[- ]effective\\w*', 'costs?', 'financial', 'match\\w*', 'leverag\\w*', 'expenses?'],
    whenNoStrengths:
      'Gather your current operating budget and any funding goals your board has set, and approve them in your profile.',
  },
  {
    id: 'partnerships_capacity',
    heading: 'Partnerships and capacity',
    purpose: 'Show who will carry out the work with you, and that your organization can manage it.',
    questions: [
      {
        text: 'Which partners have a role in this project, and which document records what each has agreed to do?',
        why: 'Funders often ask for letters of commitment. A partnership without one may not count.',
      },
      {
        text: 'What in your staffing, governance or finances shows that you can manage a grant of this size?',
        why: 'Capacity is usually scored, and reviewers look for evidence such as audits and grants already managed.',
      },
      {
        text: 'Who would lead this work, and which of their experience is already written down?',
        why: 'Naming people and their documented experience makes capacity concrete.',
      },
      {
        text: 'What would you need to add to deliver this project, and how will you say so plainly?',
        why: 'Being direct about what you will build is more credible than implying it already exists.',
      },
    ],
    fields: ['capacity'],
    rfpSections: [],
    keywords: ['partner\\w*', 'capacity', 'staff\\w*', 'collaborat\\w*', 'employers?', 'governance', 'management', 'organizational', 'leadership'],
    whenNoStrengths:
      'Gather what shows your capacity: staffing, board, audits, grants you have managed, and letters from the partners you will name.',
  },
  {
    id: 'sustainability',
    heading: 'Sustainability',
    purpose: 'Explain how the work and its results continue after this grant ends.',
    questions: [
      {
        text: 'Which part of this work will continue after the grant ends, and what will pay for it?',
        why: 'Funders want to know that what they invest in lasts beyond the grant period.',
      },
      {
        text: 'Which of your funding sources are already in place for the years after this grant?',
        why: 'Sources that exist are stronger evidence than a plan to look for money later.',
      },
      {
        text: 'What will the people you serve be able to do on their own because of this project?',
        why: 'Lasting change in what people can do is a kind of sustainability reviewers recognize.',
      },
    ],
    fields: [],
    rfpSections: ['funding_period'],
    keywords: ['sustain\\w*', 'long[- ]term', 'continu\\w*', 'beyond the grant'],
    whenNoStrengths:
      'Gather what shows how this work continues after the grant: other funders, earned income or a plan your board has approved.',
  },
  {
    id: 'attachments_compliance',
    heading: 'Required attachments and compliance',
    purpose: 'Make sure every required document, step and rule is met before you submit.',
    questions: [
      {
        text: 'Which required documents do you already have, and which need a signature or time to obtain?',
        why: 'A missing attachment can sink an application, however strong the rest of it is.',
      },
      {
        text: 'Who in your organization will check each eligibility rule against your records before you apply?',
        why: "Eligibility is the funder's decision, so confirm each rule with a document in hand.",
      },
      {
        text: 'What does the funder say about how to submit and by when, and what earlier deadline will you set yourself?',
        why: 'Portals and registrations can take days. Your own earlier deadline leaves room for problems.',
      },
      {
        text: 'What does the funder say about using AI tools, and what will you need to disclose?',
        why: 'Some funders limit AI assistance or ask applicants to disclose it. Following that rule is your responsibility.',
      },
    ],
    fields: [],
    rfpSections: ['eligibility', 'deadlines', 'required_documents', 'submission_steps', 'reporting'],
    keywords: ['attachments?', 'complian\\w*', 'certif\\w*', 'forms?', 'deadlines?', 'submission'],
    whenNoStrengths: 'Gather each required attachment, and note who signs it and how long it takes to obtain.',
  },
];

/** Shown once, at the top of a guide built before any statement has been approved. */
export const PROFILE_INVITATION = `No statements in your organization profile are approved yet. Complete and approve your profile in the ${FUNDING_SCREENS.knowledgeHub} so this guide can start from your documented strengths.`;

/** Parts of an analysis whose items are placed by their wording, since they can belong anywhere. */
const PLACED_BY_KEYWORD: readonly RfpSectionId[] = ['priorities', 'evaluation_criteria'];
/** Where a priority or criterion goes when none of its words says otherwise. */
const DEFAULT_PLACEMENT: StandardSectionId = 'project_design';

const KEYWORD_PATTERNS = new Map(
  STANDARD_OUTLINE.map((section) => [section.id, new RegExp(`\\b(?:${section.keywords.join('|')})\\b`, 'gi')]),
);

/**
 * The part of the outline in which something the funder asks for is listed.
 * Most parts of an analysis have one home. Priorities and evaluation criteria
 * go where most of their words point, and the earlier part wins a tie.
 */
export function placeRequirement(section: RfpSectionId, text: string): StandardSectionId {
  if (!PLACED_BY_KEYWORD.includes(section)) {
    const home = STANDARD_OUTLINE.find((candidate) => candidate.rfpSections.includes(section));
    if (home) return home.id;
  }
  let best = DEFAULT_PLACEMENT;
  let most = 0;
  for (const candidate of STANDARD_OUTLINE) {
    const hits = text.match(KEYWORD_PATTERNS.get(candidate.id) ?? /(?!)/g)?.length ?? 0;
    if (hits > most) {
      most = hits;
      best = candidate.id;
    }
  }
  return best;
}
