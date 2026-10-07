import { FundingError } from '../funding/errors.js';

/** Converts recognized listing links to adapter ids; never fetches user-supplied hosts. */
export function opportunityIdFromLink(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000)
    throw new FundingError('INVALID_INPUT', 'Enter an official listing link.');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new FundingError('INVALID_INPUT', 'Enter a complete HTTPS link to an official listing.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new FundingError(
      'INVALID_INPUT',
      'Use an HTTPS official listing link without credentials or a custom port.',
    );
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/$/, '');
  let match: RegExpExecArray | null;
  if (
    ['www.grants.gov', 'grants.gov'].includes(host) &&
    (match = /^\/search-results-detail\/(\d{1,12})$/.exec(path))
  )
    return `grants-gov:${match[1]}`;
  if (host === 'simpler.grants.gov' && (match = /^\/opportunity\/(\d{1,12})$/.exec(path)))
    return `grants-gov:${match[1]}`;
  if (
    ['www.grants.ca.gov', 'grants.ca.gov'].includes(host) &&
    /^\d{1,12}$/.test(url.searchParams.get('p') ?? '')
  )
    return `ca-grants-portal:${url.searchParams.get('p')}`;
  if (host === 'a856-cityrecord.nyc.gov' && (match = /^\/RequestDetail\/(\d{1,12})$/i.exec(path)))
    return `nyc-city-record:${match[1]}`;
  if (
    host === 'ec.europa.eu' &&
    (match =
      /^\/info\/funding-tenders\/opportunities\/portal\/screen\/opportunities\/topic-details\/([a-z0-9_.-]{1,150})$/i.exec(
        path,
      ))
  )
    return `eu-funding-tenders:topic-${match[1]!.toUpperCase()}`;
  throw new FundingError(
    'INVALID_INPUT',
    'This link cannot be read by a connected official source. Upload the funder’s notice, or find its listing in Opportunities. Supported links: Grants.gov, California Grants Portal, NYC City Record and EU topic notices.',
  );
}
