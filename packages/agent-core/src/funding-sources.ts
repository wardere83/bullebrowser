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

/** Guidance is advisory; source URLs are still filtered after search returns. */
export function fundingSearchQuery(query: string, fundingOnly: boolean): string {
  return fundingOnly ? `${query} official grant program eligibility -site:instrumentl.com -site:grantable.co -site:grantwatch.com -site:grantstation.com -site:grantforward.com -site:fundsforngos.org` : query;
}
