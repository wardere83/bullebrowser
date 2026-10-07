// What a listing needs from the screen it is shown on. The Opportunities
// screen provides it once, so a card several levels down can save a listing,
// ask before anything leaves the device and open an analysis without each
// view passing the same things along.

import { createContext, useContext } from 'react';
import type { SavedOpportunity } from '../../../shared/funding.js';
import type { RunWithConsent } from './hooks.js';

export interface ListingServices {
  /** The organization's country (ISO code), which decides what counts as international for it. */
  organizationCountry: string;
  /** Whether the session may save listings, write notes and start an analysis. */
  canManage: boolean;
  /** Runs a call that sends something off the device, asking first when the acknowledgement is missing. */
  runWithConsent: RunWithConsent;
  /** The saved entry for a listing, when it is saved. */
  savedEntry(opportunityId: string): SavedOpportunity | undefined;
  /** Takes the saved list a change returned. */
  applySaved(list: SavedOpportunity[]): void;
  /** Opens the analysis of a funding document in RFP Analysis. */
  openAnalysis(rfpId: string): void;
}

const ListingServicesContext = createContext<ListingServices | null>(null);

export const ListingServicesProvider = ListingServicesContext.Provider;

export function useListingServices(): ListingServices {
  const services = useContext(ListingServicesContext);
  if (!services) throw new Error('A listing was rendered outside the Opportunities screen.');
  return services;
}

/** Said once above a list of listings when the session may read but not change them. */
export const READ_ONLY_NOTE =
  'Your role can read listings. An owner, admin or member can also save them, write notes, check a status again and start an analysis.';
