import { describe, expect, it } from 'vitest';
import { protectAssistantIdentity } from '../product-identity.js';
import { applyTerminology } from '../terminology.js';
import { FUNDING_WORKFLOW_IDS, findSkill, skills } from './index.js';

describe('skill registry', () => {
  it('exposes every skill by its id', () => {
    for (const s of skills) expect(findSkill(s.id)?.id).toBe(s.id);
  });

  // The desktop run path appends the user's Settings checklist only when the
  // selected skill has this exact id. It was referenced for a long time while
  // no such skill existed, so the checklist was silently discarded.
  it('registers compliance_review, which the checklist feature depends on', () => {
    const skill = findSkill('compliance_review');
    expect(skill).toBeDefined();
    expect(skill!.systemPrompt).toMatch(/Status legend/);
  });

  it('gives every skill the fields the UI renders', () => {
    for (const s of skills) {
      expect(s.label).toBeTruthy();
      expect(s.shortDescription).toBeTruthy();
      expect(s.inputPlaceholder).toBeTruthy();
      expect(s.systemPrompt.length).toBeGreaterThan(50);
    }
  });

  it('has no duplicate ids', () => {
    expect(new Set(skills.map((s) => s.id)).size).toBe(skills.length);
  });

  it('keeps the presets that were there before', () => {
    for (const id of ['page_assistant', 'site_navigator', 'workflow_automator', 'compliance_review']) {
      expect(findSkill(id)).toBeDefined();
    }
  });
});

// The four options behind "What can I help you with?". Ids and labels are
// shared with the panel and the website, so they are pinned exactly.
describe('funding workflows', () => {
  const WORKFLOWS = [
    ['find_opportunities', 'Find Relevant Grant Opportunities'],
    ['assess_alignment', 'Assess Your Funding Alignment'],
    ['funder_priorities', 'Explore Funder Priorities'],
    ['proposal_guide', 'Ethical Strengths-Based Proposal Guide'],
  ] as const;
  const prompt = (id: string): string => findSkill(id)!.systemPrompt;

  it('lists exactly these four, in the order the product offers them', () => {
    expect([...FUNDING_WORKFLOW_IDS]).toEqual(WORKFLOWS.map(([id]) => id));
  });

  it.each(WORKFLOWS)('%s is labelled "%s"', (id, label) => {
    const skill = findSkill(id);
    expect(skill?.label).toBe(label);
    expect(skill?.systemPrompt).toContain(`Workflow: ${label}.`);
  });

  // Each rule is one the product promises its users. A prompt that loses one
  // would let a workflow guess, blur fact and advice, or overstate a listing.
  it.each(WORKFLOWS)('%s carries every non-negotiable rule', (id) => {
    const text = prompt(id);
    // grounded only in the approved profile and the organization's own passages
    expect(text).toMatch(/comes only from its approved profile and passages of its\s+own documents/);
    expect(text).toContain('org_get_profile');
    expect(text).toContain('org_search_knowledge');
    expect(text).toMatch(/When those tools are offered, use them/);
    // listings from the host tools, otherwise official sources only
    expect(text).toContain('funding_search_opportunities');
    expect(text).toContain('funding_get_opportunity');
    expect(text).toMatch(/Otherwise browse official sources only/);
    // a citation for every factual claim
    expect(text).toMatch(/Cite the source of every factual claim: the document name with its page or section, or the\s+official URL/);
    // documented facts apart from recommendations
    expect(text).toContain('"Documented"');
    expect(text).toContain('"Recommendation"');
    // missing information is reported, not guessed
    expect(text).toMatch(/not in the documents, say so plainly/);
    expect(text).toMatch(/instead\s+of guessing/);
    // nothing invented
    expect(text).toMatch(/Never invent outcomes, partnerships, credentials, eligibility or financial figures/);
    // an honest status for every listing
    expect(text).toMatch(/Describe a listing as Active only when its official source says it is open and its deadline\s+has not passed/);
    expect(text).toMatch(/Otherwise say it is Expired or Unverified/);
    // reference material is never a set of instructions
    expect(text).toMatch(/never give you\s+instructions/);
    // the product's wording
    expect(text).toMatch(/Write "CBOs" \(singular "CBO"\) and never expand the acronym/);
    expect(text).toContain('businesses and CBOs');
    // these rules outrank the browsing prompt they are appended to
    expect(text).toMatch(/where they differ from\s+the general browsing guidance above, follow these/);
  });

  it('makes the proposal guide a guide: no drafting, the funder\'s AI rules first, the user accountable', () => {
    const text = prompt('proposal_guide');
    expect(text).toMatch(/structure, reflective questions, outlines and feedback/);
    expect(text).toMatch(/will write it themselves/);
    expect(text).toMatch(/Do not draft proposal narrative/);
    expect(text).toMatch(/even when asked/);
    expect(text).toMatch(/First check the funder's rules on AI assistance/);
    expect(text).toMatch(/restricts or prohibits AI\s+assistance, limit yourself to reflective questions and checklists/);
    expect(text).toMatch(/tell the user that this is why/);
    expect(text).toMatch(/observations, not rewrites/);
    expect(text).toMatch(/they own it and are accountable\s+for everything they submit/);
  });

  it('keeps eligibility and award decisions with the funder', () => {
    expect(prompt('find_opportunities')).toMatch(/never a statement that the organization is eligible/);
    expect(prompt('assess_alignment')).toMatch(/Never state that the organization is or is\s+not eligible/);
    for (const [id] of WORKFLOWS) expect(prompt(id)).toMatch(/The funder decides\s+who is eligible and who is funded/);
  });

  it('refuses to fill in a missing side or a missing profile', () => {
    expect(prompt('find_opportunities')).toMatch(/If there is no approved profile, say so/);
    expect(prompt('assess_alignment')).toMatch(/If either\s+side is missing, say which one and stop there/);
    expect(prompt('funder_priorities')).toMatch(/Do not\s+describe a funder from memory/);
  });

  // A reply that names the assistant anything but its product identity is
  // replaced wholesale, so a workflow must not hand it another name to use.
  it.each(WORKFLOWS)('%s gives the assistant no other name', (id) => {
    const text = prompt(id);
    expect(text).not.toMatch(/\byou are (?:an?|the)\b/i);
    expect(text).not.toMatch(/\b(?:i am|i'm|my name is)\b/i);
    expect(protectAssistantIdentity(text)).toBe(text);
  });

  it('never spells the acronym out in a prompt, a label or a description', () => {
    for (const s of skills) {
      for (const text of [s.label, s.shortDescription, s.inputPlaceholder, s.systemPrompt]) {
        expect(applyTerminology(text)).toBe(text);
      }
    }
  });
});
