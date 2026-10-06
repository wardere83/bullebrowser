// Plain search phrases for each part of an organization profile.
//
// With no assistant connected, the app can still offer the passages where an
// organization is likely to have stated its mission, the people it serves and
// so on, word for word, for a person to pick from. These phrases are how those
// passages are found. They are the headings and turns of phrase organizations
// tend to use, not a reading of the text: a passage found this way is only a
// suggestion until someone confirms it.
//
// Search a field's phrases together (joined with spaces) for the best ranking,
// or one at a time for variety.

import type { ProfileFieldId } from '../../shared/funding.js';

export const PROFILE_FIELD_QUERIES: Record<ProfileFieldId, string[]> = {
  mission: ['our mission is', 'mission statement', 'exists to', 'our purpose', 'we believe', 'dedicated to'],
  populations_served: [
    'populations served',
    'who we serve',
    'we serve',
    'participants clients customers',
    'adults youth seniors families households',
    'low-income immigrants veterans',
  ],
  geographic_scope: [
    'service area',
    'geographic scope',
    'located in',
    'neighborhood city county region',
    'statewide citywide',
  ],
  strategic_priorities: [
    'strategic priorities',
    'strategic plan',
    'priority',
    'goals and objectives',
    'investment priorities',
    'adopted by the board',
  ],
  programs: [
    'our programs',
    'program description',
    'services we offer',
    'courses classes workshops',
    'taught coaching training curriculum',
    'products we manufacture',
  ],
  strengths: [
    'demonstrated strengths',
    'what sets us apart',
    'track record',
    'expertise and experience',
    'certifications accredited licensed',
    'recognized award-winning',
  ],
  impact_evidence: [
    'impact',
    'outcomes and results',
    'percent of participants graduates',
    'completed graduated employed',
    'increase average gained',
    'evaluation measured',
  ],
  capacity: [
    'organizational capacity',
    'full-time part-time staff',
    'employs employees',
    'board of directors',
    'annual operating budget',
    'financial audit',
  ],
  funding_goals: [
    'funding goals',
    'we are seeking',
    'we request',
    'raise',
    'funding needed',
    'amount requested',
  ],
};
