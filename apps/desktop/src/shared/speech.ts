/** Keep chat intact while preparing concise, readable sentences for speech. */
export function speechText(input: string): string {
  const lines: string[] = [];
  let fence = '';
  for (const line of input.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) { fence = marker[0]!; lines.push('A code example is available in the chat.'); }
      else if (marker[0] === fence) fence = '';
      continue;
    }
    if (!fence) lines.push(line);
  }
  return lines.join('\n')
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')
    .replace(/!?\[([^\]]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/\[\^\w+\]|\[\d+(?:[,\s-]+\d+)*\]/g, '')
    .replace(/<?(?:https?:\/\/|www\.)[^\s<>]+>?/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\|/g, ', ')
    .replace(/\b([\w.+-]+)@([\w.-]+\.[a-z]{2,})\b/gi,
      (_match, user: string, host: string) => `${user.replace(/\./g, ' dot ')} at ${host.replace(/\./g, ' dot ')}`)
    .replace(/&amp;/g, ' and ').replace(/&lt;/g, ' less than ').replace(/&gt;/g, ' greater than ')
    .replace(/\n+/g, '. ')
    .replace(/([.!?])\s*\./g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

/**
 * Bound inference time per clip without dropping the end of long answers. A
 * shorter opening clip lets the reply start speaking sooner.
 */
export function speechChunks(input: string, maxLength = 300, openingLength = maxLength): string[] {
  const clamp = (value: number) => Math.max(40, Math.min(600, Math.floor(value) || 300));
  const limit = clamp(maxLength);
  const opening = Math.min(limit, clamp(openingLength));
  const chunks: string[] = [];
  let remaining = speechText(input);
  for (let size = opening; remaining.length > size; size = limit) {
    const window = remaining.slice(0, size + 1);
    // Prefer ending on a sentence, then on a clause, and only then mid-phrase.
    let end = [...window.matchAll(/[.!?;](?=\s)/g)].at(-1)?.index;
    if (end === undefined || end < size / 3) {
      const clause = [...window.matchAll(/[,:\u2013\u2014](?=\s)/g)].at(-1)?.index;
      end = clause !== undefined && clause >= size / 3 ? clause + 1 : window.lastIndexOf(' ');
    } else end++;
    if (end <= 0) end = size;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
