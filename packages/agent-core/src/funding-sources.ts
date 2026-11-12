/** Discovery exclusions, not a global browser/network block list. */
export const GRANT_SEARCH_SERVICES = [
  'instrumentl.com', 'grantable.co', 'grantwatch.com', 'grantstation.com',
  'grantforward.com', 'fundsforngos.org',
] as const;

export function isGrantSearchService(value: string | URL): boolean {
  try {
    const host = (value instanceof URL ? value : new URL(value)).hostname.toLowerCase().replace(/\.+$/, '');
    return GRANT_SEARCH_SERVICES.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

export function isFundingDiscoveryRequest(request: string): boolean {
  // Comparing software is ordinary research, not finding an actual award.
  if (/\b(?:compare|review|what is|alternatives to)\b/i.test(request)
    && /\b(?:grant[- ](?:search|writing|management)\s+(?:software|platforms?|tools?)|instrumentl|grantable)\b/i.test(request)) return false;
  return /\b(?:grants?|funding|funders?|rfps?|nofos?)\b/i.test(request);
}

/**
 * Guidance is advisory; source URLs are still filtered after search returns.
 * `siteExclusions: false` leaves out the -site: operators. Bing treats a query
 * carrying six of them as noise and answers with unrelated pages ("youth
 * mentoring grants Newark NJ" returned Wikipedia's "Youth" and an IMDb page),
 * while the same query without them returns the official programs.
 */
export function fundingSearchQuery(query: string, fundingOnly: boolean, { siteExclusions = true } = {}): string {
  // Search engines need topic words, not the assistant's command prefix.
  // Keep ordinary product/title searches untouched (for example Find My).
  const topic = fundingOnly ? query.trim().replace(/^(?:(?:please|can you|could you)\s+)*(?:find|search(?: the web)?(?: for)?|look for)\s+/i, '') : query;
  if (!fundingOnly) return query;
  const exclusions = siteExclusions ? ' -site:instrumentl.com -site:grantable.co -site:grantwatch.com -site:grantstation.com -site:grantforward.com -site:fundsforngos.org' : '';
  return `${topic} official grant program eligibility${exclusions}`;
}
