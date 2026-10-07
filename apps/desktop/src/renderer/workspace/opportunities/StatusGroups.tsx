// Listings set out under their status: active first, then unverified, then
// expired, each group under a heading that says what the status means. Search
// results and saved listings are both shown this way, so an active listing is
// never read in a row with one that is closed or unconfirmed.

import { useId, type ReactNode } from 'react';
import { OPPORTUNITY_STATUS_LABELS, type OpportunityStatus } from '../../../shared/funding.js';
import { pluralize } from '../../lib/funding-client.js';
import { Badge, SectionHeading, layout } from '../ui/index.js';
import { STATUS_MEANINGS } from './filters.js';
import { groupByStatus } from './results.js';

export interface StatusGroupsProps<T> {
  items: readonly T[];
  statusOf(item: T): OpportunityStatus;
  keyOf(item: T): string;
  /** Draws one item; its title should be a level 4 heading, under the group's level 3. */
  children(item: T): ReactNode;
}

export function StatusGroups<T>({ items, statusOf, keyOf, children }: StatusGroupsProps<T>) {
  const baseId = useId();
  return (
    <>
      {groupByStatus(items, statusOf).map((group) => {
        const headingId = `${baseId}-${group.status}`;
        return (
          <section key={group.status} aria-labelledby={headingId} className={layout.section}>
            <SectionHeading
              level={3}
              id={headingId}
              title={OPPORTUNITY_STATUS_LABELS[group.status]}
              addon={<Badge>{pluralize(group.items.length, 'listing')}</Badge>}
              description={STATUS_MEANINGS[group.status]}
            />
            <ul className="flex flex-col gap-4">
              {group.items.map((item) => (
                <li key={keyOf(item)}>{children(item)}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
