// The Opportunities screen: find funding from official sources at citywide,
// countywide, statewide, federal and international levels, keep the listings
// worth following, and reach the official sites the app cannot search itself.
//
// One rule runs through all of it: nothing is shown as a listing unless it
// came back from a search of the official sources or from the organization's
// saved listings, and every listing says what its status is, why, where it
// was read and when. There are no sample listings anywhere on this screen.
//
// The screen holds what its three views share (the consent gate, the saved
// listings, the sources and the search) so that a search still lands when the
// person has looked at another view. The views themselves are in
// ../opportunities/.

import { useCallback, useMemo } from 'react';
import { fundingBridge, unwrap, useAsync } from '../../lib/funding-client.js';
import {
  useActiveOrganization,
  useCan,
  useRouteParams,
  useWorkspaceStore,
  type WorkspaceParams,
} from '../../state/workspace-store.js';
import { useConsentGate } from '../ConsentGate.js';
import {
  unreadableAnswer,
  useNow,
  useOpportunitySearch,
  useSavedListings,
  type RunWithConsent,
} from '../opportunities/hooks.js';
import { PortalsView } from '../opportunities/PortalsView.js';
import { SavedView } from '../opportunities/SavedView.js';
import { SearchView } from '../opportunities/SearchView.js';
import { ListingServicesProvider, type ListingServices } from '../opportunities/services.js';
import { readSources } from '../opportunities/shapes.js';
import { Screen, TabPanel, Tabs } from '../ui/index.js';

type View = NonNullable<WorkspaceParams['opportunities']['view']>;

const VIEWS: readonly View[] = ['search', 'saved', 'portals'];
const TABS_ID = 'opportunities-views';

export function Opportunities() {
  const params = useRouteParams('opportunities');
  const visit = useWorkspaceStore((state) => state.visit);
  const navigate = useWorkspaceStore((state) => state.navigate);
  const organization = useActiveOrganization();
  const canManage = useCan('funding.manage');
  const consent = useConsentGate();

  const now = useNow();
  const saved = useSavedListings(now);
  const sources = useAsync(async () => {
    const list = readSources(await unwrap(fundingBridge().opportunities.sources()));
    if (!list) throw unreadableAnswer();
    return list;
  }, []);

  // Reading a listing can need more than one acknowledgement; each is asked
  // for in turn, and declining either one ends the call with nothing sent.
  const { run } = consent;
  const runWithConsent = useCallback<RunWithConsent>((call) => run(() => run(call)), [run]);
  const search = useOpportunitySearch(runWithConsent);

  const view: View = VIEWS.find((known) => known === params.view) ?? 'search';
  const openView = useCallback(
    (next: View) => navigate('opportunities', { view: next }),
    [navigate],
  );

  const organizationCountry = organization?.location.country ?? '';
  const { byId, apply } = saved;
  const services = useMemo<ListingServices>(
    () => ({
      organizationCountry,
      canManage,
      runWithConsent,
      savedEntry: (opportunityId) => byId.get(opportunityId),
      applySaved: apply,
      openAnalysis: (rfpId) => navigate('rfp', { rfpId, view: 'analysis' }),
    }),
    [organizationCountry, canManage, runWithConsent, byId, apply, navigate],
  );

  return (
    <Screen
      title="Opportunities"
      description="Find funding from official sources at citywide, countywide, statewide, federal and international levels. Every listing shows its status, the source it came from and when it was read."
    >
      <ListingServicesProvider value={services}>
        <div className="flex flex-col gap-6">
          <Tabs
            id={TABS_ID}
            label="Views of Opportunities"
            tabs={[
              { id: 'search', label: 'Search' },
              {
                id: 'saved',
                label: 'Saved',
                count: saved.state === 'ready' ? saved.list.length : undefined,
              },
              { id: 'portals', label: 'Official portals' },
            ]}
            value={view}
            onChange={openView}
          />
          <TabPanel tabsId={TABS_ID} tab={view}>
            {view === 'search' && (
              <SearchView
                organization={organization}
                search={search}
                sources={sources}
                now={now}
                linkedOpportunityId={params.opportunityId}
                tailored={params.tailored === true}
                visit={visit}
                onDismissLinked={() => openView('search')}
                onOpenPortals={() => openView('portals')}
              />
            )}
            {view === 'saved' && (
              <SavedView
                saved={saved}
                focusOpportunityId={params.opportunityId}
                visit={visit}
                onOpenSearch={() => openView('search')}
              />
            )}
            {view === 'portals' && <PortalsView organization={organization} />}
          </TabPanel>
        </div>
      </ListingServicesProvider>
      {consent.dialog}
    </Screen>
  );
}
