// The four things the assistant offers to help with, in this order and with
// these exact labels.
//
// `route` and `params` are where the workflow lives in the workspace.
// `skillId` names the set of rules the assistant follows for that workflow; the
// panel passes it with the user's next message.

import type { WorkspaceLocation } from '../state/workspace-store.js';
import type { IconName } from './ui/icons.js';

export type WorkflowId =
  | 'find_opportunities'
  | 'assess_alignment'
  | 'funder_priorities'
  | 'proposal_guide';

export type Workflow = WorkspaceLocation & {
  id: WorkflowId;
  /** Shown as written, capitals included. */
  label: string;
  /** One sentence saying what the workflow does. */
  description: string;
  skillId: WorkflowId;
  icon: IconName;
};

export const WORKFLOWS: readonly Workflow[] = [
  {
    id: 'find_opportunities',
    label: 'Find Relevant Grant Opportunities',
    description:
      'Search official funding sources and filter by place, applicant type, amount and deadline.',
    route: 'opportunities',
    params: {},
    skillId: 'find_opportunities',
    icon: 'search',
  },
  {
    id: 'assess_alignment',
    label: 'Assess Your Funding Alignment',
    description:
      'Compare what a funding document asks for with what your organization’s documents show.',
    route: 'rfp',
    params: { view: 'alignment' },
    skillId: 'assess_alignment',
    icon: 'scale',
  },
  {
    id: 'funder_priorities',
    label: 'Explore Funder Priorities',
    description:
      'Read what a funder is investing in and how it judges applications, cited to its own document.',
    route: 'rfp',
    params: { view: 'priorities' },
    skillId: 'funder_priorities',
    icon: 'compass',
  },
  {
    id: 'proposal_guide',
    label: 'Ethical Strengths-Based Proposal Guide',
    description:
      'Plan a proposal in your own words, with outlines, reflective questions and evidence prompts.',
    route: 'guide',
    params: {},
    skillId: 'proposal_guide',
    icon: 'pencil',
  },
];

/** The workflow a skill id belongs to, if it is one of the four. */
export function workflowForSkill(skillId: string | null | undefined): Workflow | undefined {
  return WORKFLOWS.find((workflow) => workflow.skillId === skillId);
}
