// PDFs and Word files the user attaches are read before the task starts, so
// the assistant sees their text the same way it sees an attached text file.
// A file that cannot be read is left as it was (named, not shown inline).

import type { RunAttachment } from '../../shared/ipc.js';
import type { ExtractedDocument } from '../documents/types.js';
import { documentToText } from '../documents/plain-text.js';

export interface AttachedDocumentSources {
  documentFile(id: string): { path: string; name: string } | null;
  projectFileIds(id: string): string[];
  extract(path: string, name: string, signal?: AbortSignal): Promise<ExtractedDocument>;
}

/** Most documents read for one message; the rest stay named only. */
export const MAX_ATTACHED_DOCUMENTS = 6;

export async function readAttachedDocuments(
  attachments: RunAttachment[] | undefined,
  sources: AttachedDocumentSources,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  if (!attachments?.length) return texts;
  const ids: string[] = [];
  for (const a of attachments) {
    if (a.kind === 'file') ids.push(a.fileId);
    else if (a.kind === 'project') ids.push(...sources.projectFileIds(a.projectId));
  }
  const wanted = [...new Set(ids)].filter((id) => sources.documentFile(id)).slice(0, MAX_ATTACHED_DOCUMENTS);
  await Promise.all(wanted.map(async (id) => {
    const file = sources.documentFile(id);
    if (!file) return;
    try {
      const text = documentToText(await sources.extract(file.path, file.name, signal), 20_000);
      if (text.trim()) texts.set(id, text);
    } catch {
      /* unreadable or too large: the file stays listed by name */
    }
  }));
  return texts;
}
