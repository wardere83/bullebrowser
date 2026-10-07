// The Saved view: the listings the organization has kept, each with its
// status as it stands now. A saved status only becomes less certain with time
// (main ages it whenever the list is read), until the person checks it again.

import { useEffect, useId, useRef, useState } from 'react';
import { fundingBridge, pluralize, toCallError, unwrap } from '../../lib/funding-client.js';
import {
  Button,
  Card,
  EmptyState,
  InlineAlert,
  LoadingBlock,
  SectionHeading,
  announce,
  layout,
  text,
} from '../ui/index.js';
import { unreadableAnswer, useAlive, type SavedListings } from './hooks.js';
import { ListingCard } from './ListingCard.js';
import { shownStatus } from './listing.js';
import { savedSummary } from './saved.js';
import { READ_ONLY_NOTE, useListingServices } from './services.js';
import { readSavedList } from './shapes.js';
import { StatusGroups } from './StatusGroups.js';

export interface SavedViewProps {
  saved: SavedListings;
  /** A saved listing another screen asked to bring into view. */
  focusOpportunityId?: string;
  /** Goes up each time the screen is opened, so the same listing can be asked for again. */
  visit: number;
  onOpenSearch(): void;
}

export function SavedView({ saved, focusOpportunityId, visit, onOpenSearch }: SavedViewProps) {
  const services = useListingServices();
  const alive = useAlive();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titles = useRef(new Map<string, HTMLHeadingElement>());
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const ready = saved.state === 'ready';

  // Opened for one listing (from the dashboard, say): bring it into view and
  // put focus on its title. The workspace scrolls a newly opened screen to the
  // top and places focus itself, so this waits until that is done.
  const shownFor = useRef('');
  useEffect(() => {
    if (!focusOpportunityId || !ready) return;
    const request = `${visit}:${focusOpportunityId}`;
    if (shownFor.current === request) return;
    const timer = setTimeout(() => {
      shownFor.current = request;
      const title = titles.current.get(focusOpportunityId);
      if (!title) return;
      title.closest('article')?.scrollIntoView({ block: 'start' });
      title.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [focusOpportunityId, visit, ready]);

  const recheck = async () => {
    if (checking) return;
    setChecking(true);
    setProblem(null);
    try {
      const list = readSavedList(
        await services.runWithConsent(() => unwrap(fundingBridge().opportunities.recheckSaved())),
      );
      if (!alive.current) return;
      if (!list) throw unreadableAnswer();
      saved.apply(list);
      announce(`Status checked again for ${pluralize(list.length, 'saved listing')}.`);
    } catch (error) {
      if (!alive.current) return;
      const failed = toCallError(error);
      // Declining to ask the sources is a choice, not a failure.
      if (failed.code !== 'CANCELLED') setProblem(failed.message);
    } finally {
      if (alive.current) setChecking(false);
    }
  };

  const { list } = saved;
  const linkedIsMissing =
    ready && focusOpportunityId !== undefined && !saved.byId.has(focusOpportunityId);

  return (
    <section aria-labelledby={headingId} className={layout.section}>
      <SectionHeading
        level={2}
        id={headingId}
        headingRef={headingRef}
        title="Saved listings"
        description="Each listing is shown with its status as it stands now. Time can only make a saved status less certain; checking again reads every listing from its source."
        actions={
          services.canManage && list.length > 0 ? (
            <Button
              size="sm"
              icon="refresh"
              busy={checking}
              busyLabel="Checking each saved listing at its source"
              onClick={() => void recheck()}
            >
              Check status again
            </Button>
          ) : undefined
        }
      />

      {saved.state === 'loading' && <LoadingBlock label="Loading saved listings" lines={4} />}

      {saved.state === 'error' && (
        <InlineAlert
          tone="error"
          action={
            <Button size="sm" onClick={saved.reload}>
              Try again
            </Button>
          }
        >
          {saved.error?.message ?? 'The saved listings could not be read.'}
        </InlineAlert>
      )}

      {ready && (
        <>
          {saved.error && (
            <InlineAlert
              tone="caution"
              title="This list may be out of date."
              action={
                <Button size="sm" onClick={saved.reload}>
                  Try again
                </Button>
              }
            >
              {saved.error.message}
            </InlineAlert>
          )}
          {problem && <InlineAlert tone="error">{problem}</InlineAlert>}
          {linkedIsMissing && (
            <InlineAlert tone="info">
              The listing you opened is no longer among your saved listings.
            </InlineAlert>
          )}

          {list.length === 0 ? (
            <Card padding="lg">
              <EmptyState
                icon="bookmark"
                title="No saved listings yet"
                body="A listing you save from a search is kept here with its status, its deadline and a note of your own."
                action={
                  <Button size="sm" trailingIcon="arrow-right" onClick={onOpenSearch}>
                    Search official sources
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              <p className={text.body}>{savedSummary(list)}</p>
              {!services.canManage && <p className={text.small}>{READ_ONLY_NOTE}</p>}
              <StatusGroups
                items={list}
                statusOf={(entry) => shownStatus(entry.opportunity).status}
                keyOf={(entry) => entry.opportunity.id}
              >
                {(entry) => (
                  <ListingCard
                    opportunity={entry.opportunity}
                    variant="saved"
                    headingLevel={4}
                    titleRef={(element) => {
                      if (element) titles.current.set(entry.opportunity.id, element);
                      else titles.current.delete(entry.opportunity.id);
                    }}
                    // The card is about to go; put focus where the list begins.
                    onRemoved={() => headingRef.current?.focus()}
                  />
                )}
              </StatusGroups>
            </>
          )}
        </>
      )}
    </section>
  );
}
