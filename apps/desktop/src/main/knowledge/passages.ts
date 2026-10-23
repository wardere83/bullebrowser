// Grouping a document's blocks into passages: the unit that is searched,
// ranked and offered to the user. A passage is always whole blocks from one
// page, so it can be cited by block and its text is exactly what was extracted.

import { SECTION_SEPARATOR, type ExtractedBlock } from '../documents/types.js';

export interface Passage {
  /** `${documentId}:${id of the first block}`; stable for one version of a document. */
  id: string;
  documentId: string;
  blockIds: string[];
  /** 1-based page for PDFs; null for formats without pages. */
  page: number | null;
  /** Heading path the passage sits under, including a heading it starts with. */
  section: string;
  /** The blocks' texts joined with '\n'. */
  text: string;
}

export interface PassageOptions {
  /** A passage stops taking blocks once it is this long. Default 900. */
  targetChars?: number;
  /** A passage never grows past this, unless one block alone is longer. Default 1,600. */
  maxChars?: number;
}

const DEFAULT_TARGET_CHARS = 900;
const DEFAULT_MAX_CHARS = 1600;

function limit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

/** The text a group of blocks makes: each block on its own line. */
function joinedLength(blocks: ExtractedBlock[]): number {
  return blocks.reduce((total, block) => total + block.text.length, 0) + Math.max(0, blocks.length - 1);
}

function sectionOf(blocks: ExtractedBlock[]): string {
  // Text under a heading already names that heading in its section.
  const body = blocks.find((block) => block.kind !== 'heading');
  if (body) return body.section;
  // Only headings: the path ends with the last of them.
  const last = blocks[blocks.length - 1];
  if (!last) return '';
  return last.section ? `${last.section}${SECTION_SEPARATOR}${last.text}` : last.text;
}

/**
 * Splits a document into passages, in reading order.
 *
 * - A heading starts a new passage and is its first line. Headings with nothing
 *   between them stay together, so a title is not separated from its text.
 * - A passage never crosses a page and never splits a block.
 * - Blocks are added until the passage reaches the target length, and never
 *   past the maximum. A block longer than the maximum stands alone, with the
 *   headings that introduce it.
 * - Consecutive table rows stay together: a table starts a new passage when it
 *   would not otherwise fit, and only a table longer than the maximum is split,
 *   between rows.
 */
export function buildPassages(documentId: string, blocks: ExtractedBlock[], options: PassageOptions = {}): Passage[] {
  const target = limit(options.targetChars, DEFAULT_TARGET_CHARS);
  const max = Math.max(target, limit(options.maxChars, DEFAULT_MAX_CHARS));
  const usable = blocks.filter((block) => block.text.trim().length > 0);

  const passages: Passage[] = [];
  let current: ExtractedBlock[] = [];
  let hasBody = false;

  const close = () => {
    const first = current[0];
    if (first) {
      passages.push({
        id: `${documentId}:${first.id}`,
        documentId,
        blockIds: current.map((block) => block.id),
        page: first.page,
        section: sectionOf(current),
        text: current.map((block) => block.text).join('\n'),
      });
    }
    current = [];
    hasBody = false;
  };

  usable.forEach((block, index) => {
    const previous = current[current.length - 1];
    const isHeading = block.kind === 'heading';
    const continuesTable = block.kind === 'table_row' && previous?.kind === 'table_row';

    if (previous) {
      const size = joinedLength(current) + 1 + block.text.length;
      let startsNew = previous.page !== block.page || (isHeading && hasBody);
      if (!startsNew && hasBody) {
        startsNew = size > max || (!continuesTable && joinedLength(current) >= target);
      }
      if (!startsNew && hasBody && block.kind === 'table_row' && !continuesTable) {
        // The first row of a table: keep the table whole if it can be.
        let end = index;
        while (usable[end + 1]?.kind === 'table_row' && usable[end + 1]?.page === block.page) end += 1;
        const table = joinedLength(usable.slice(index, end + 1));
        startsNew = table <= max && joinedLength(current) + 1 + table > max;
      }
      if (startsNew) close();
    }

    current.push(block);
    if (!isHeading) hasBody = true;
  });
  close();

  return passages;
}
