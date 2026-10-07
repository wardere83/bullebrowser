import { describe, expect, it } from 'vitest';
import {
  COMPLETE_PROFILE_FIRST,
  KNOWLEDGE_HUB_DESCRIPTION,
  LOCATION_HINT,
  POSITIONING,
} from './copy.js';
import { ROUTES, routeDefinition } from './routes.js';
import { ICON_NAMES } from './ui/icons.js';
import { WORKFLOWS, workflowForSkill } from './workflows.js';

describe('the navigation', () => {
  it('lists the five screens in order, with their exact names', () => {
    expect(ROUTES.map((definition) => definition.label)).toEqual([
      'Dashboard',
      'Opportunities',
      'Organization Knowledge Hub',
      'RFP Analysis',
      'Proposal Guide',
    ]);
    expect(ROUTES.map((definition) => definition.route)).toEqual([
      'dashboard',
      'opportunities',
      'knowledge',
      'rfp',
      'guide',
    ]);
  });

  it('ties every route to a screen component and an icon that exists', () => {
    for (const definition of ROUTES) {
      expect(typeof definition.component).toBe('function');
      expect(ICON_NAMES).toContain(definition.icon);
    }
    expect(new Set(ROUTES.map((definition) => definition.component)).size).toBe(ROUTES.length);
  });

  it('finds the screen for a route', () => {
    expect(routeDefinition('rfp').label).toBe('RFP Analysis');
    expect(routeDefinition('dashboard')).toBe(ROUTES[0]);
  });
});

describe('the four workflows', () => {
  it('are exactly these, in this order, with this capitalization', () => {
    expect(WORKFLOWS.map((workflow) => workflow.label)).toEqual([
      'Find Relevant Grant Opportunities',
      'Assess Our Funding Alignment',
      'Explore Funder Priorities',
      'Ethical Strengths-Based Proposal Guide',
    ]);
  });

  it('lead to the right screens', () => {
    expect(WORKFLOWS.map(({ route, params }) => ({ route, params }))).toEqual([
      { route: 'opportunities', params: {} },
      { route: 'rfp', params: { view: 'alignment' } },
      { route: 'rfp', params: { view: 'priorities' } },
      { route: 'guide', params: {} },
    ]);
  });

  it('carry the skill ids the assistant knows them by', () => {
    expect(WORKFLOWS.map((workflow) => workflow.skillId)).toEqual([
      'find_opportunities',
      'assess_alignment',
      'funder_priorities',
      'proposal_guide',
    ]);
    expect(WORKFLOWS.map((workflow) => workflow.id)).toEqual(
      WORKFLOWS.map((workflow) => workflow.skillId),
    );
    expect(workflowForSkill('funder_priorities')?.label).toBe('Explore Funder Priorities');
    expect(workflowForSkill('page_assistant')).toBeUndefined();
    expect(workflowForSkill('')).toBeUndefined();
  });

  it('each have a one-sentence description and an icon that exists', () => {
    for (const workflow of WORKFLOWS) {
      expect(workflow.description).toMatch(/^[A-Z][^.!?]*\.$/);
      expect(ICON_NAMES).toContain(workflow.icon);
    }
  });
});

describe('fixed wording', () => {
  it('states the positioning in one sentence', () => {
    expect(POSITIONING).toBe(
      'BulleBrowser is a strategic funding platform for businesses and CBOs: discover opportunities, understand funder priorities, assess your alignment and develop proposals ethically.',
    );
  });

  it('describes the Organization Knowledge Hub exactly as agreed', () => {
    expect(KNOWLEDGE_HUB_DESCRIPTION).toBe(
      "Upload your organization's documents so BulleBrowser aligns its guidance with your mission, priorities, strengths, and funding goals.",
    );
  });

  it('explains what the location is for and that it stays on the device', () => {
    expect(LOCATION_HINT).toBe(
      'Used to find citywide, countywide and statewide funding for you. It stays on this device.',
    );
  });

  it('asks for the profile before tailored guidance', () => {
    expect(COMPLETE_PROFILE_FIRST).toBe(
      'Complete your profile before asking for tailored guidance.',
    );
  });
});
