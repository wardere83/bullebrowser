// A single listing another screen asked to open, shown above the search
// results with its details. It is read from its official source like any
// other listing, and stands apart from the results so it is never taken for
// something the current search returned.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Opportunity, OpportunityDetail } from '../../../shared/funding.js';
import { fundingBridge, toCallError, unwrap } from '../../lib/funding-client.js';
import { Button, InlineAlert, LoadingBlock, SectionHeading, layout, text } from '../ui/index.js';
import { unreadableAnswer, useAlive } from './hooks.js';
import { ListingCard } from './ListingCard.js';
import { useListingServices } from './services.js';
import { readDetail } from './shapes.js';

export interface LinkedListingProps {
  opportunityId: string;
  /** The listing itself, when the current results already hold it. */
  found?: Opportunity;
  onDismiss(): void;
}

type Reading =
  | { phase: 'loading' }
  | { phase: 'ready'; detail: OpportunityDetail }
  | { phase: 'declined' }
  | { phase: 'error'; message: string };

export function LinkedListing({ opportunityId, found, onDismiss }: LinkedListingProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={layout.section}>
      <SectionHeading
        level={2}
        id={headingId}
        title="Listing you opened"
        description="Shown apart from the results below, which belong to your search."
        actions={
          <Button size="sm" variant="quiet" onClick={onDismiss}>
            Dismiss
          </Button>
        }
      />
      {found ? (
        <ListingCard
          key={found.id}
          opportunity={found}
          variant="result"
          headingLevel={3}
          openDetailAtOnce
        />
      ) : (
        <ReadFromSource key={opportunityId} opportunityId={opportunityId} />
      )}
    </section>
  );
}

/** Reads a listing the screen does not hold yet, then shows it with what was read. */
function ReadFromSource({ opportunityId }: { opportunityId: string }) {
  const { runWithConsent } = useListingServices();
  const alive = useAlive();
  const requests = useRef(0);
  const [reading, setReading] = useState<Reading>({ phase: 'loading' });

  const read = useCallback(async () => {
    requests.current += 1;
    const request = requests.current;
    const wanted = () => alive.current && request === requests.current;
    setReading({ phase: 'loading' });
    try {
      const answer = readDetail(
        await runWithConsent(() => unwrap(fundingBridge().opportunities.detail(opportunityId))),
      );
      if (!wanted()) return;
      if (!answer || answer.opportunity.id !== opportunityId) throw unreadableAnswer();
      setReading({ phase: 'ready', detail: answer });
    } catch (error) {
      if (!wanted()) return;
      const failed = toCallError(error);
      setReading(
        failed.code === 'CANCELLED'
          ? { phase: 'declined' }
          : { phase: 'error', message: failed.message },
      );
    }
  }, [alive, opportunityId, runWithConsent]);

  useEffect(() => {
    void read();
  }, [read]);

  if (reading.phase === 'loading') {
    return <LoadingBlock label="Reading the listing from its source" lines={4} />;
  }
  if (reading.phase === 'ready') {
    return (
      <ListingCard
        opportunity={reading.detail.opportunity}
        variant="result"
        headingLevel={3}
        initialDetail={reading.detail}
      />
    );
  }
  if (reading.phase === 'declined') {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className={text.small}>
          The listing was not read, because reading it means asking its official source.
        </p>
        <Button size="sm" onClick={() => void read()}>
          Read the listing
        </Button>
      </div>
    );
  }
  return (
    <InlineAlert
      tone="error"
      action={
        <Button size="sm" onClick={() => void read()}>
          Try again
        </Button>
      }
    >
      {reading.message}
    </InlineAlert>
  );
}
