import { useRouteParams, type RfpView } from '../../state/workspace-store.js';
import { Card, EmptyState, Screen } from '../ui/index.js';

// Placeholder. The RFP Analysis screen replaces this file.
//
// What a screen file must keep: it exports the component named in routes.ts,
// takes no props, returns a <Screen> (which renders the one h1) at once, and
// reads what it was opened with from the store. This screen is opened with
// `{ view: 'alignment' }` and `{ view: 'priorities' }` from the two workflows
// that live here, with `{ rfpId, view: 'analysis' }` from the dashboard, and
// with no parameters from the navigation.
const PREPARING: Record<RfpView, string> = {
  analysis:
    'A plain-language reading of a funding document, cited to its pages and sections, will appear here.',
  alignment:
    'A comparison of what a funding document asks for with what your organization’s documents show will appear here.',
  priorities:
    'What a funder is investing in and how it judges applications, cited to its own document, will appear here.',
};

export function RfpAnalysis() {
  const { view = 'analysis' } = useRouteParams('rfp');

  return (
    <Screen
      title="RFP Analysis"
      description="Add a funding document to see what the funder asks for, with each point cited to the page or section it comes from."
    >
      <Card padding="lg">
        <EmptyState icon="document" title="This screen is being prepared" body={PREPARING[view]} />
      </Card>
    </Screen>
  );
}
