// What "Details" opens under a listing: the longer text, labelled facts and
// links the official source gives for it, read again at that moment.

import type { ReactNode } from 'react';
import {
  OPPORTUNITY_STATUS_LABELS,
  type Opportunity,
  type OpportunityDetail,
} from '../../../shared/funding.js';
import { NOT_STATED, formatDate, formatDateTime } from '../../lib/funding-client.js';
import {
  DefinitionList,
  DefinitionRow,
  ExternalLink,
  InlineAlert,
  StatusBadge,
  cx,
  layout,
  linkHost,
  text,
} from '../ui/index.js';
import { awardDisplay, shownStatus } from './listing.js';

function DetailBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className={text.overline}>{label}</p>
      {children}
    </div>
  );
}

export interface ListingDetailProps {
  /** What the source returned for this listing just now. */
  detail: OpportunityDetail;
  /** The listing as the card above shows it, read earlier. */
  shown: Opportunity;
}

/**
 * The source's own description, facts and links for one listing. Reading them
 * re-reads the listing, so its status as of this reading is shown too, and a
 * change since the card was drawn is pointed out rather than left for the
 * person to notice.
 */
export function ListingDetail({ detail, shown }: ListingDetailProps) {
  const fresh = detail.opportunity;
  const status = shownStatus(fresh);
  const before = shownStatus(shown);
  const source = (fresh.sourceName ?? '').trim() || 'the source';
  const description = detail.description.trim() || (fresh.summary ?? '').trim();
  const award = awardDisplay(fresh);

  return (
    <div className={layout.section}>
      <div className={layout.stack}>
        <p className={text.caption}>
          Read from {source} on {formatDateTime(fresh.fetchedAt)}.
        </p>
        <StatusBadge kind="opportunity" status={status.status} reason={status.reason} />
        {status.status !== before.status && (
          <InlineAlert tone="caution" announce>
            The status has changed since this listing was first read. It was{' '}
            {OPPORTUNITY_STATUS_LABELS[before.status].toLowerCase()} and is now{' '}
            {OPPORTUNITY_STATUS_LABELS[status.status].toLowerCase()}.
          </InlineAlert>
        )}
      </div>

      <DetailBlock label="Description from the source">
        {description ? (
          <p className={cx(text.body, layout.prose, 'whitespace-pre-line break-words')}>
            {description}
          </p>
        ) : (
          <p className={text.small}>The source gives no description for this listing.</p>
        )}
      </DetailBlock>

      <DetailBlock label="More from the listing">
        <DefinitionList>
          <DefinitionRow term="Reference number">
            {(fresh.number ?? '').trim() || NOT_STATED}
          </DefinitionRow>
          <DefinitionRow term="Opens">{formatDate(fresh.openDate)}</DefinitionRow>
          <DefinitionRow term="Total funding">{award.total || NOT_STATED}</DefinitionRow>
          <DefinitionRow term="Status at the source">
            {(fresh.sourceStatus ?? '').trim() || NOT_STATED}
          </DefinitionRow>
        </DefinitionList>
      </DetailBlock>

      {detail.facts.length > 0 && (
        <DetailBlock label="Facts from the source">
          <DefinitionList>
            {detail.facts.map((fact, index) => (
              <DefinitionRow key={`${fact.label}:${index}`} term={fact.label}>
                {fact.value.trim() || NOT_STATED}
              </DefinitionRow>
            ))}
          </DefinitionList>
        </DetailBlock>
      )}

      {detail.links.length > 0 && (
        <DetailBlock label="Other official links">
          <ul className="flex flex-col gap-1.5">
            {detail.links.map((link, index) => (
              <li key={`${link.url}:${index}`} className="text-sm leading-5">
                <ExternalLink href={link.url}>
                  {link.label.trim() || linkHost(link.url) || link.url}
                </ExternalLink>
              </li>
            ))}
          </ul>
        </DetailBlock>
      )}
    </div>
  );
}
