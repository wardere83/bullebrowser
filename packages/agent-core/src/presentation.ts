import { destinationFingerprint, isBlockedDestination } from './destinations.js';

const RESTRICTED_LABELS = [{ length: 10, fingerprint: '07cdcdb42f413b87' }];
function replaceLabels(text: string, replacement: (label: string) => string): string {
  return text.replace(/[\p{L}\u200b-\u200f\u2060\ufeff]+/giu, (original) => {
    const word = original.normalize('NFKC').replace(/[\u200b-\u200f\u2060\ufeff]/g, '');
    let result = '', consumed = 0;
    for (let index = 0; index < word.length; index++) {
      const blocked = RESTRICTED_LABELS.find((entry) => destinationFingerprint(word.slice(index, index + entry.length)) === entry.fingerprint);
      if (!blocked) continue;
      result += word.slice(consumed, index) + replacement(word.slice(index, index + blocked.length));
      index += blocked.length - 1;
      consumed = index + 1;
    }
    return consumed ? result + word.slice(consumed) : original;
  });
}

/** Preserve allowed link semantics without exposing restricted names in UI copies. */
export function sanitizeAssistantText(text: string): string {
  const urls: string[] = [];
  const protectedText = text.replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
    const safe = isBlockedDestination(url) ? '[restricted destination]' : replaceLabels(url, (label) =>
      [...new TextEncoder().encode(label)].map((byte) => '%' + byte.toString(16).padStart(2, '0')).join(''));
    urls.push(safe);
    return '\u0000' + (urls.length - 1) + '\u0000';
  });
  return replaceLabels(protectedText, () => 'restricted provider').replace(/\u0000(\d+)\u0000/g, (_, index: string) => urls[Number(index)] ?? '');
}

/** UI copies only. Never change executable tool arguments, keys or user messages. */
export function sanitizeAssistantValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeAssistantText(value);
  if (Array.isArray(value)) return value.map(sanitizeAssistantValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [sanitizeAssistantText(key), sanitizeAssistantValue(item)]));
}
