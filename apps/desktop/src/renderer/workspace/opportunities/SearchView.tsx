// The Search view: the filters, and under or beside them what the official
// sources returned. The filters and the last result are kept for the visit, so
// looking at another screen and coming back loses nothing.

import { useMemo, useRef, useState } from 'react';
import type {
  FundingSourceInfo,
  OpportunityFilters,
  Organization,
} from '../../../shared/funding.js';
import { fundingBridge, toCallError, unwrap, type AsyncResult } from '../../lib/funding-client.js';
import { useCan, useScreenState, useWorkspaceStore } from '../../state/workspace-store.js';
import { useWorkspaceLayout } from '../layout.js';
import { Button, InlineAlert, announce, cx, layout, text } from '../ui/index.js';
import { FilterForm } from './FilterForm.js';
import {
  applySuggestion,
  defaultDraft,
  placeFromLocation,
  readBasis,
  readDraft,
  type FilterDraft,
} from './filters.js';
import { currentOrganizationId, useAlive, type OpportunitySearch } from './hooks.js';
import { LinkedListing } from './LinkedListing.js';
import { SearchResults } from './SearchResults.js';
import { knownSourceIds } from './sources.js';

/** Filters taken from the approved profile, with the reasons main gave and what they replaced. */
interface Suggestion {
  basis: string[];
  previous: FilterDraft;
}

const FILTERS_KEY = 'opportunities.filters';
const SUGGESTION_KEY = 'opportunities.suggestion';

export interface SearchViewProps {
  organization: Organization | null;
  search: OpportunitySearch;
  sources: AsyncResult<FundingSourceInfo[]>;
  now: number;
  /** A listing another screen asked to open here. */
  linkedOpportunityId?: string;
  onDismissLinked(): void;
  onOpenPortals(): void;
}

export function SearchView({
  organization,
  search,
  sources,
  now,
  linkedOpportunityId,
  onDismissLinked,
  onOpenPortals,
}: SearchViewProps) {
  const { columns } = useWorkspaceLayout();
  const navigate = useWorkspaceStore((state) => state.navigate);
  const setup = useWorkspaceStore((state) => state.setup);
  const maySuggest = useCan('knowledge.read');
  const alive = useAlive();

  // Until the person changes something, the filters are the defaults with the
  // organization's place, and follow that place if it is edited.
  const location = organization?.location;
  const [country, region, county, city] = [
    location?.country ?? '',
    location?.region ?? '',
    location?.county ?? '',
    location?.city ?? '',
  ];
  const organizationPlace = useMemo(
    () => placeFromLocation({ country, region, county, city }),
    [country, region, county, city],
  );
  const defaults = useMemo(() => defaultDraft(organizationPlace), [organizationPlace]);
  const [stored, setStored] = useScreenState<FilterDraft | null>(FILTERS_KEY, null);
  const draft = stored ?? defaults;

  const [suggestion, setSuggestion] = useScreenState<Suggestion | null>(SUGGESTION_KEY, null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestProblem, setSuggestProblem] = useState<
    { kind: 'empty' } | { kind: 'failed'; message: string } | null
  >(null);
  // A new form for every reset, so its own errors and open groups start over.
  const [formVersion, setFormVersion] = useState(0);

  const formRef = useRef<HTMLFormElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  const runSearch = async (filters: OpportunityFilters) => {
    // A source the app no longer offers is not sent: main would search nothing for it.
    const sent = sources.value
      ? { ...filters, sourceIds: knownSourceIds(filters.sourceIds, sources.value) }
      : filters;
    const outcome = await search.run(sent);
    if (outcome !== 'found' || !alive.current) return;
    // The person is still where they started the search: take them to what it
    // found. If they have moved on, the result is only announced.
    const active = document.activeElement;
    if (active instanceof Node && formRef.current?.contains(active)) {
      resultsHeading.current?.focus();
    }
  };

  const reset = () => {
    setStored(null);
    setSuggestion(null);
    setSuggestProblem(null);
    setFormVersion((version) => version + 1);
    announce('Filters reset.');
  };

  const suggest = async () => {
    if (suggesting) return;
    const organizationId = currentOrganizationId();
    setSuggesting(true);
    setSuggestProblem(null);
    try {
      const answer = await unwrap(fundingBridge().opportunities.suggestFilters());
      if (!alive.current || currentOrganizationId() !== organizationId) return;
      const basis = readBasis(answer?.basis);
      const suggested = answer?.filters;
      // Filters that come without a reason are not taken: the person must be
      // able to see why each one was suggested.
      if (basis.length === 0 || typeof suggested !== 'object' || suggested === null) {
        setSuggestProblem({ kind: 'empty' });
        return;
      }
      setSuggestion({ basis, previous: draft });
      setStored(applySuggestion(draft, suggested));
      announce('Filters set from your approved profile. Review them before you search.');
    } catch (error) {
      if (!alive.current) return;
      const failed = toCallError(error);
      if (failed.code !== 'CANCELLED') setSuggestProblem({ kind: 'failed', message: failed.message });
    } finally {
      if (alive.current) setSuggesting(false);
    }
  };

  // Suggestions rest on approved statements only; without one there is nothing to draw on.
  const profileReady = setup ? setup.readyForTailoredGuidance : true;
  const openProfile = () => navigate('knowledge', { tab: 'profile' });

  const actions = (
    <>
      {maySuggest && (
        <Button
          size="sm"
          busy={suggesting}
          busyLabel="Reading your approved profile"
          disabled={!profileReady}
          onClick={() => void suggest()}
        >
          Use our approved profile
        </Button>
      )}
      <Button size="sm" variant="quiet" onClick={reset}>
        Reset filters
      </Button>
    </>
  );

  const notice = (
    <>
      {!maySuggest && (
        <p className={text.small}>
          Your role cannot read the organization’s profile, so filters cannot be suggested from it.
        </p>
      )}
      {maySuggest && !profileReady && (
        <div className="flex flex-col items-start gap-2">
          <p className={text.small}>
            Filters can be suggested from your profile once at least one statement in it is
            approved.
          </p>
          <Button size="sm" variant="quiet" onClick={openProfile}>
            Review profile
          </Button>
        </div>
      )}
      {suggestProblem?.kind === 'failed' && (
        <InlineAlert tone="error">{suggestProblem.message}</InlineAlert>
      )}
      {suggestProblem?.kind === 'empty' && (
        <InlineAlert
          tone="info"
          announce
          action={
            <Button size="sm" variant="quiet" onClick={openProfile}>
              Review profile
            </Button>
          }
        >
          Nothing in your approved profile points to a filter yet, so the filters are unchanged.
        </InlineAlert>
      )}
      {suggestion && (
        <InlineAlert tone="info" title="Filters set from your approved profile.">
          <span>
            Each reason below comes from your approved profile. Change anything before you search.
          </span>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {suggestion.basis.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
          <div className={cx(layout.row, 'mt-3')}>
            <Button
              size="sm"
              onClick={() => {
                setStored(suggestion.previous);
                setSuggestion(null);
                announce('Previous filters restored.');
              }}
            >
              Restore previous filters
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setSuggestion(null)}>
              Dismiss
            </Button>
          </div>
        </InlineAlert>
      )}
    </>
  );

  const reading = readDraft(draft);
  const refusal = search.error?.code === 'INVALID_INPUT' ? search.error.message : null;

  const form = (
    <FilterForm
      key={formVersion}
      formRef={formRef}
      draft={draft}
      onChange={setStored}
      onSearch={(filters) => void runSearch(filters)}
      searching={search.searching}
      refusal={refusal}
      sources={sources}
      organizationPlace={organizationPlace}
      actions={actions}
      notice={notice}
    />
  );

  const results = (
    <div className={layout.screen}>
      {linkedOpportunityId && (
        <LinkedListing
          opportunityId={linkedOpportunityId}
          found={search.snapshot?.result.opportunities.find(
            (opportunity) => opportunity.id === linkedOpportunityId,
          )}
          onDismiss={onDismissLinked}
        />
      )}
      <SearchResults
        search={search}
        sources={sources}
        currentFilters={reading.ok ? reading.filters : null}
        now={now}
        headingRef={resultsHeading}
        onRetry={() => {
          if (search.attempted) void runSearch(search.attempted);
        }}
        onOpenPortals={onOpenPortals}
      />
    </div>
  );

  // One column at the default window size: the filters, then the results.
  if (columns === 1) {
    return (
      <div className={layout.screen}>
        {form}
        {results}
      </div>
    );
  }
  return (
    <div
      className="grid items-start gap-8"
      style={{
        gridTemplateColumns:
          columns === 2 ? 'minmax(0, 20rem) minmax(0, 1fr)' : 'minmax(0, 24rem) minmax(0, 1fr)',
      }}
    >
      {form}
      {results}
    </div>
  );
}
