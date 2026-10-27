import { destinationFingerprint, isBlockedDestination } from './destinations.js';

const RESTRICTED_LABELS = new Set(['07cdcdb42f413b87']);

/** Defense against names resurfacing from old chats, model prose or page titles. */
export function sanitizeAssistantText(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, (url) => isBlockedDestination(url) ? '[restricted destination]' : url)
    .replace(/[\p{L}\u200b-\u200f\u2060\ufeff]+/giu, (word) => RESTRICTED_LABELS.has(destinationFingerprint(word.normalize('NFKC').replace(/[\u200b-\u200f\u2060\ufeff]/g, ''))) ? 'restricted provider' : word);
}

/** UI copies only. Never change executable tool arguments, keys or user messages. */
export function sanitizeAssistantValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeAssistantText(value);
  if (Array.isArray(value)) return value.map(sanitizeAssistantValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [sanitizeAssistantText(key), sanitizeAssistantValue(item)]));
}
