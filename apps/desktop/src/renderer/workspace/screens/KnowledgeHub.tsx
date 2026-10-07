import { useRouteParams } from '../../state/workspace-store.js';
import { KNOWLEDGE_HUB_DESCRIPTION } from '../copy.js';
import { Card, EmptyState, Screen } from '../ui/index.js';

// Placeholder. The Organization Knowledge Hub screen replaces this file.
//
// What a screen file must keep: it exports the component named in routes.ts,
// takes no props, returns a <Screen> (which renders the one h1) at once, and
// reads what it was opened with from the store. This screen is opened with
// `{ tab: 'profile' }` from onboarding and from the assistant panel, and with
// no parameters from the navigation.
export function KnowledgeHub() {
  const { tab } = useRouteParams('knowledge');

  return (
    <Screen title="Organization Knowledge Hub" description={KNOWLEDGE_HUB_DESCRIPTION}>
      <Card padding="lg">
        <EmptyState
          icon="library"
          title="This screen is being prepared"
          body={
            tab === 'profile'
              ? 'Your organization’s proposed profile will appear here for you to review and approve.'
              : 'Your organization’s documents, their processing state and the profile proposed from them will appear here.'
          }
        />
      </Card>
    </Screen>
  );
}
