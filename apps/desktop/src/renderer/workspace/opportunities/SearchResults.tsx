// What a search returned. Nothing is listed here that did not come back from
// `opportunities.search`: before the first search this area explains what
// will be searched, and after it every listing stands under its status, with
// the sources that were read, failed or left out named beside the count.

import { useId, type Ref } from 'react';
import {
  type FundingSourceInfo,
  type OpportunityFilters,
  type SourceRunReport,
} from '../../../shared/funding.js';
import { formatDateTime, type AsyncResult } from '../../lib/funding-client.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineAlert,
  LoadingBlock,
  SectionHeading,
  cx,
  layout,
  text,
  type BadgeTone,
  type IconName,
} from '../ui/index.js';
import { sameFilters } from './filters.js';
import type { OpportunitySearch, SearchSnapshot } from './hooks.js';
import { ListingCard } from './ListingCard.js';
import { shownStatus } from './listing.js';
import { Fold } from './parts.js';
import {
  REPORT_OUTCOME_LABELS,
  foundSentence,
  incompleteSentence,
  readSentence,
  reportCounts,
  reportOutcome,
  reportSentence,
  resultsAreOld,
  summarizeReports,
  truncatedSentence,
  type ReportOutcome,
} from './results.js';
import { READ_ONLY_NOTE, useListingServices } from './services.js';
import { sourceSummary } from './sources.js';
import { StatusGroups } from './StatusGroups.js';

export interface SearchResultsProps {
  search: OpportunitySearch;
  sources: AsyncResult<FundingSourceInfo[]>;
  /** The filters as the form holds them now, or null while they do not pass its checks. */
  currentFilters: OpportunityFilters | null;
  /** The time, for saying that results have aged. */
  now: number;
  headingRef?: Ref<HTMLHeadingElement>;
  onRetry(): void;
  onOpenPortals(): void;
}

export function SearchResults({
  search,
  sources,
  currentFilters,
  now,
  headingRef,
  onRetry,
  onOpenPortals,
}: SearchResultsProps) {
  const headingId = useId();
  const { snapshot, searching, error } = search;
  // A refusal of the filters themselves is shown with the form, where it can be fixed.
  const failure = error && error.code !== 'INVALID_INPUT' ? error : null;

  return (
    <section aria-labelledby={headingId} className={layout.section}>
      <SectionHeading level={2} id={headingId} title="Results" headingRef={headingRef} />

      {searching && (
        <div className={layout.stack}>
          <p className={text.small}>
            Reading the official sources. The listings appear here once every source has answered.
          </p>
          <LoadingBlock label="Searching the official sources" lines={4} />
        </div>
      )}

      {!searching && failure && (
        <InlineAlert
          tone="error"
          action={
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          }
        >
          {failure.message}
        </InlineAlert>
      )}

      {!searching && !snapshot && !failure && (
        <BeforeFirstSearch sources={sources} onOpenPortals={onOpenPortals} />
      )}

      {!searching && snapshot && (
        <ResultBody
          snapshot={snapshot}
          afterFailure={Boolean(failure)}
          currentFilters={currentFilters}
          now={now}
          onOpenPortals={onOpenPortals}
        />
      )}
    </section>
  );
}

// ───────────────────────────── before the first search ─────────────────────────

function BeforeFirstSearch({
  sources,
  onOpenPortals,
}: {
  sources: AsyncResult<FundingSourceInfo[]>;
  onOpenPortals(): void;
}) {
  return (
    <Card padding="lg" className={layout.section}>
      <EmptyState
        icon="search"
        title="Nothing has been searched yet"
        body="When you search, BulleBrowser asks the official sources below for listings that match your filters and lists only what they return. Each listing shows its status, the source it came from and when it was read."
      />
      <SourcesOverview sources={sources} />
      <div className="flex flex-col items-start gap-2">
        <p className={text.small}>
          For places these sources do not cover, Official portals lists official funding sites you
          can visit yourself.
        </p>
        <Button size="sm" variant="quiet" trailingIcon="arrow-right" onClick={onOpenPortals}>
          Open Official portals
        </Button>
      </div>
    </Card>
  );
}

/** The sources a search can read, by name. They are where listings would come from, never listings. */
function SourcesOverview({ sources }: { sources: AsyncResult<FundingSourceInfo[]> }) {
  const headingId = useId();
  const list = sources.value;
  return (
    <section aria-labelledby={headingId} className={layout.stack}>
      <SectionHeading level={3} id={headingId} title="Official sources BulleBrowser reads" />
      {sources.state === 'loading' && (
        <LoadingBlock label="Loading the official sources" lines={3} />
      )}
      {sources.state === 'error' && (
        <InlineAlert
          tone="error"
          action={
            <Button size="sm" onClick={sources.reload}>
              Try again
            </Button>
          }
        >
          {sources.error.message}
        </InlineAlert>
      )}
      {list && list.length === 0 && (
        <p className={text.small}>No official source is available to search.</p>
      )}
      {list && list.length > 0 && (
        <ul className={layout.list}>
          {list.map((source) => (
            <li key={source.id} className="py-2.5 first:pt-0 last:pb-0">
              <p className="break-words text-sm font-medium leading-5 text-ink-inverse">
                {source.name}
              </p>
              <p className={cx(text.caption, 'mt-0.5')}>{sourceSummary(source)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ──────────────────────────────── after a search ───────────────────────────────

function ResultBody({
  snapshot,
  afterFailure,
  currentFilters,
  now,
  onOpenPortals,
}: {
  snapshot: SearchSnapshot;
  /** True when a later search failed and these are the results of the one before it. */
  afterFailure: boolean;
  currentFilters: OpportunityFilters | null;
  now: number;
  onOpenPortals(): void;
}) {
  const services = useListingServices();
  const { result, filters, unreadable } = snapshot;
  const summary = summarizeReports(result.reports);
  const count = result.opportunities.length;
  const filtersChanged = !currentFilters || !sameFilters(currentFilters, filters);

  return (
    <>
      <div className={layout.stack}>
        <p className={text.body}>
          <span className="font-semibold text-ink-inverse">{foundSentence(count)}</span>{' '}
          {readSentence(summary, result.searchedAt)}
        </p>

        {afterFailure && (
          <InlineAlert tone="info">
            These are the results of your earlier search. The search you just started did not
            finish.
          </InlineAlert>
        )}
        {!afterFailure && filtersChanged && (
          <InlineAlert tone="info">
            The filters have changed since this search. Search again to bring the results up to
            date.
          </InlineAlert>
        )}
        {resultsAreOld(result.searchedAt, now) && (
          <InlineAlert tone="caution" title="These results are more than a day old.">
            A status shown here was read on {formatDateTime(result.searchedAt)}. Search again
            before relying on it.
          </InlineAlert>
        )}
        {summary.failed.length > 0 && (
          <InlineAlert tone="caution" title="These results are incomplete.">
            {incompleteSentence(summary.failed)}
          </InlineAlert>
        )}
        {result.truncated && <InlineAlert tone="info">{truncatedSentence(count)}</InlineAlert>}
        {unreadable > 0 && (
          <InlineAlert tone="caution">
            {unreadable === 1
              ? 'One listing the sources returned could not be shown, because it arrived without a title or a reference.'
              : `${unreadable} listings the sources returned could not be shown, because they arrived without a title or a reference.`}
          </InlineAlert>
        )}

        {result.reports.length > 0 && (
          <SourceReports
            reports={result.reports}
            counts={reportCounts(summary)}
            defaultOpen={summary.failed.length > 0 || summary.read.length === 0}
          />
        )}
      </div>

      {count === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon="search"
            title="No listings matched"
            body={
              summary.read.length === 0
                ? 'No source was read for these filters, so there is nothing to list. Official portals lists official funding sites for places the sources do not cover.'
                : 'The sources that were read returned nothing for these filters. Try fewer filters, another status or a wider place.'
            }
            action={
              summary.read.length === 0 ? (
                <Button size="sm" trailingIcon="arrow-right" onClick={onOpenPortals}>
                  Open Official portals
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {!services.canManage && <p className={text.small}>{READ_ONLY_NOTE}</p>}
          <StatusGroups
            items={result.opportunities}
            statusOf={(opportunity) => shownStatus(opportunity).status}
            keyOf={(opportunity) => opportunity.id}
          >
            {(opportunity) => (
              <ListingCard opportunity={opportunity} variant="result" headingLevel={4} />
            )}
          </StatusGroups>
        </>
      )}
    </>
  );
}

const OUTCOME_LOOK: Record<ReportOutcome, { tone: BadgeTone; icon: IconName }> = {
  read: { tone: 'success', icon: 'check-circle' },
  failed: { tone: 'danger', icon: 'alert' },
  skipped: { tone: 'neutral', icon: 'circle-dashed' },
};

/** Each source's part in the search: what it returned, why it failed, or why it was not asked. */
function SourceReports({
  reports,
  counts,
  defaultOpen,
}: {
  reports: readonly SourceRunReport[];
  counts: string;
  defaultOpen: boolean;
}) {
  return (
    <Fold title="What each source returned" summary={counts} defaultOpen={defaultOpen}>
      <ul className={layout.list}>
        {reports.map((report) => {
          const outcome = reportOutcome(report);
          const look = OUTCOME_LOOK[outcome];
          return (
            <li key={report.sourceId} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 break-words text-sm font-medium leading-5 text-ink-inverse">
                  {report.sourceName}
                </span>
                <Badge tone={look.tone} icon={look.icon}>
                  {REPORT_OUTCOME_LABELS[outcome]}
                </Badge>
              </div>
              <p className={text.small}>{reportSentence(report)}</p>
              {outcome === 'read' && (
                <p className={text.caption}>Read on {formatDateTime(report.fetchedAt)}</p>
              )}
            </li>
          );
        })}
      </ul>
    </Fold>
  );
}
