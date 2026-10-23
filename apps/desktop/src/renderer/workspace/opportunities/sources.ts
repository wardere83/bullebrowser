// How an official source the app can search is described: who runs it, the
// level and place it covers, and what it lists. A source is never a listing;
// these words only say where listings would come from.

import {
  GEO_LEVEL_LABELS,
  OPPORTUNITY_KIND_LABELS,
  type FundingSourceInfo,
  type OpportunityKind,
} from '../../../shared/funding.js';
import { listInWords } from './results.js';

/** "grants", "contract solicitations", "grants and contract solicitations". */
export function kindsInWords(kinds: readonly OpportunityKind[] | undefined): string {
  const names = [...new Set(kinds ?? [])].map(
    (kind) => `${(OPPORTUNITY_KIND_LABELS[kind] ?? String(kind)).toLowerCase()}s`,
  );
  return listInWords(names);
}

/** The level a source covers and where: "Statewide, California". */
export function sourceCoverage(source: Pick<FundingSourceInfo, 'level' | 'jurisdiction'>): string {
  const level = GEO_LEVEL_LABELS[source.level] ?? String(source.level);
  const jurisdiction = (source.jurisdiction ?? '').trim();
  return jurisdiction ? `${level}, ${jurisdiction}` : level;
}

/** One line about a source: "California State Library. Statewide, California. Lists grants." */
export function sourceSummary(
  source: Pick<FundingSourceInfo, 'operator' | 'level' | 'jurisdiction' | 'kinds'>,
): string {
  const operator = (source.operator ?? '').trim();
  const kinds = kindsInWords(source.kinds);
  return [
    operator ? `${operator}.` : '',
    `${sourceCoverage(source)}.`,
    kinds ? `Lists ${kinds}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The chosen source ids that are still on offer, in the order the sources are listed. */
export function knownSourceIds(
  chosen: readonly string[],
  sources: readonly Pick<FundingSourceInfo, 'id'>[],
): string[] {
  return sources.map((source) => source.id).filter((id) => chosen.includes(id));
}
