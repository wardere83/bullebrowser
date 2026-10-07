// Passages from the organization's own documents, as the Search tab lists them
// and the statement form offers them as evidence. A passage is text the app
// read from a document itself, so it may be shown word for word; it is never
// wording an assistant wrote.

import type { KnowledgePassage } from '../../../shared/funding.js';
import { pluralize } from '../../lib/funding-client.js';

/** How many passages a search asks for. */
export const SEARCH_LIMIT = 10;

/** What was typed, with runs of white space made single spaces. Empty when nothing was. */
export function tidyQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Tells one passage from another: a document, its version, and the blocks the passage is made of. */
export function passageKey(
  passage: Pick<KnowledgePassage, 'documentId' | 'documentVersion' | 'blockIds'>,
): string {
  return `${passage.documentId}:${passage.documentVersion}:${passage.blockIds.join('+')}`;
}

/** The passages in the order given, without any that is listed twice. */
export function uniquePassages(passages: readonly KnowledgePassage[]): KnowledgePassage[] {
  const seen = new Set<string>();
  return passages.filter((passage) => {
    const key = passageKey(passage);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Where in its document a passage is: "p. 4" when the page is known, or else its section. */
export function passagePlace(passage: Pick<KnowledgePassage, 'page' | 'section'>): string {
  return typeof passage.page === 'number' ? `p. ${passage.page}` : passage.section.trim();
}

/** What is read out when a search's answer arrives. */
export function searchAnnouncement(count: number): string {
  return count === 0 ? 'No passages found.' : `${pluralize(count, 'passage')} found.`;
}
