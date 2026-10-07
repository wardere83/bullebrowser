// The workspace's screens: which component shows for which route, what the
// navigation calls it and in what order. This table is the only place a route
// is tied to a component, so replacing a screen means replacing its file under
// screens/ and nothing else.
//
// What every screen file keeps to (screens/screens.test.tsx and
// reserved.test.ts check most of it):
//  - It exports the component named below and takes no props. What it needs it
//    reads from the workspace store: useRouteParams(route), useActiveOrganization(),
//    useCan(permission), useJob(kind, subjectId), useWorkspaceLayout().
//  - It returns a <Screen> at once, loading or not, so there is exactly one h1
//    from the first render; h2 and h3 follow in order.
//  - It talks to main only through lib/funding-client: reads with
//    useAsync(() => unwrap(fundingBridge()...)), changes in event handlers with
//    try / catch (toCallError). Never while rendering.
//  - It hears about changes with useFundingEvent(kinds, reload).
//  - It is mounted fresh for each organization, so whatever it holds is dropped
//    on a switch. Anything it wants to survive a visit to another route goes in
//    useScreenState, which is cleared on a switch too.
//  - It is built from the kit in ui/ and the class strings in ui/styles.ts.
//  - It moves between screens with navigate(route, params), and opens web
//    addresses with <ExternalLink>.

import type { ComponentType } from 'react';
import type { WorkspaceRoute } from '../state/workspace-store.js';
import { Dashboard } from './screens/Dashboard.js';
import { KnowledgeHub } from './screens/KnowledgeHub.js';
import { Opportunities } from './screens/Opportunities.js';
import { ProposalGuide } from './screens/ProposalGuide.js';
import { RfpAnalysis } from './screens/RfpAnalysis.js';
import type { IconName } from './ui/icons.js';

export interface RouteDefinition {
  route: WorkspaceRoute;
  /** The name in the navigation, and the name read out when the screen opens. */
  label: string;
  icon: IconName;
  component: ComponentType;
}

/** In navigation order. */
export const ROUTES: readonly RouteDefinition[] = [
  { route: 'dashboard', label: 'Dashboard', icon: 'home', component: Dashboard },
  { route: 'opportunities', label: 'Opportunities', icon: 'search', component: Opportunities },
  {
    route: 'knowledge',
    label: 'Organization Knowledge Hub',
    icon: 'library',
    component: KnowledgeHub,
  },
  { route: 'rfp', label: 'RFP Analysis', icon: 'document', component: RfpAnalysis },
  { route: 'guide', label: 'Proposal Guide', icon: 'pencil', component: ProposalGuide },
];

export function routeDefinition(route: WorkspaceRoute): RouteDefinition {
  const found = ROUTES.find((definition) => definition.route === route) ?? ROUTES[0];
  if (!found) throw new Error('The workspace has no screens.');
  return found;
}
