import { Card, EmptyState, Screen } from '../ui/index.js';

// Placeholder. The Proposal Guide screen replaces this file.
//
// What a screen file must keep: it exports the component named in routes.ts,
// takes no props, returns a <Screen> (which renders the one h1) at once, and
// reads what it needs from the workspace store (`useRouteParams('guide')`
// gives `{ guideId, rfpId }` when another screen opens a particular guide).
export function ProposalGuide() {
  return (
    <Screen
      title="Proposal Guide"
      description="Work through a proposal in your own words. The guide asks questions and points to your evidence; it does not write the proposal for you."
    >
      <Card padding="lg">
        <EmptyState
          icon="pencil"
          title="This screen is being prepared"
          body="Outlines, reflective questions and evidence prompts grounded in your approved profile will appear here."
        />
      </Card>
    </Screen>
  );
}
