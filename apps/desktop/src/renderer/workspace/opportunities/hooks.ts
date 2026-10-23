// What the Opportunities screen holds on behalf of its three views: the saved
// listings, the search and its last result, and a clock for noticing that what
// is on screen has aged. They live at the screen so that a search started on
// one view still lands when the person has looked at another.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type {
  OpportunityFilters,
  OpportunitySearchResult,
  SavedOpportunity,
} from '../../../shared/funding.js';
import {
  CALL_FAILED_MESSAGE,
  FundingCallError,
  fundingBridge,
  toCallError,
  unwrap,
  useAsync,
} from '../../lib/funding-client.js';
import {
  activeOrganization,
  useFundingEvent,
  useScreenState,
  useWorkspaceStore,
} from '../../state/workspace-store.js';
import { announce } from '../ui/index.js';
import { searchAnnouncement } from './results.js';
import { indexSaved } from './saved.js';
import { readSavedList, readSearchResult } from './shapes.js';

/** A call that sends something off the device, run through the consent gate. */
export type RunWithConsent = <T>(call: () => Promise<T>) => Promise<T>;

/** What is thrown when main answered in a form the screen cannot show. */
export function unreadableAnswer(): FundingCallError {
  return new FundingCallError('INTERNAL', CALL_FAILED_MESSAGE);
}

/** True while the component is mounted, for dropping an answer that arrives after it has gone. */
export function useAlive(): RefObject<boolean> {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/** The organization the workspace is in at this moment, read straight from the store. */
export function currentOrganizationId(): string | null {
  return activeOrganization(useWorkspaceStore.getState().identity)?.id ?? null;
}

// ──────────────────────────────────── clock ───────────────────────────────────

const MINUTE_MS = 60_000;

/**
 * The time, brought up to date every few minutes and when the window gets
 * attention again. A status shown here was true when it was read; the clock is
 * what lets the screen say so once that was a while ago.
 */
export function useNow(everyMs = 5 * MINUTE_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let last = Date.now();
    const tick = () => {
      const time = Date.now();
      // Coming back to the window can fire several times in a row.
      if (time - last < MINUTE_MS) return;
      last = time;
      setNow(time);
    };
    const timer = setInterval(tick, everyMs);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [everyMs]);
  return now;
}

// ─────────────────────────────── saved listings ────────────────────────────────

export interface SavedListings {
  /** "error" only when there is no list to show; a failed refresh keeps the last one. */
  state: 'loading' | 'ready' | 'error';
  /** The saved listings as far as they are known; empty until the first answer. */
  list: SavedOpportunity[];
  /** Set when the last read failed, whether or not an earlier list is still shown. */
  error: FundingCallError | null;
  byId: Map<string, SavedOpportunity>;
  reload(): void;
  /** Takes the list a change returned, so the screen is right before the next read. */
  apply(list: SavedOpportunity[]): void;
}

const NO_SAVED: SavedOpportunity[] = [];

/**
 * The organization's saved listings, kept current. Main ages each status when
 * it is asked, so the list is read again when main reports a change, when the
 * clock moves on, and after every change made here.
 */
export function useSavedListings(now: number): SavedListings {
  const loaded = useAsync(async () => {
    const list = readSavedList(await unwrap(fundingBridge().opportunities.listSaved()));
    if (!list) throw unreadableAnswer();
    return list;
  }, []);
  const { reload } = loaded;
  useFundingEvent(['saved_changed'], reload);

  const seenAt = useRef(now);
  useEffect(() => {
    if (seenAt.current === now) return;
    seenAt.current = now;
    reload();
  }, [now, reload]);

  // What a change returned stands in for the loaded list until the next read
  // arrives; it is tied to the list it replaced, so a newer read always wins.
  const [applied, setApplied] = useState<{
    over: SavedOpportunity[] | undefined;
    list: SavedOpportunity[];
  } | null>(null);
  const latestLoaded = useRef(loaded.value);
  useEffect(() => {
    latestLoaded.current = loaded.value;
  });
  const apply = useCallback(
    (list: SavedOpportunity[]) => {
      const usable = readSavedList(list);
      if (usable) setApplied({ over: latestLoaded.current, list: usable });
      reload();
    },
    [reload],
  );

  const current = applied && applied.over === loaded.value ? applied.list : loaded.value;
  const list = current ?? NO_SAVED;
  const byId = useMemo(() => indexSaved(list), [list]);
  const state = current ? 'ready' : loaded.state === 'error' ? 'error' : 'loading';
  const error = loaded.state === 'error' ? loaded.error : null;

  return useMemo(
    () => ({ state, list, error, byId, reload, apply }),
    [state, list, error, byId, reload, apply],
  );
}

// ──────────────────────────────────── search ──────────────────────────────────

/** A result together with the filters it answers, so it is never read against other filters. */
export interface SearchSnapshot {
  filters: OpportunityFilters;
  result: OpportunitySearchResult;
  /** Listings the sources returned that could not be shown. */
  unreadable: number;
}

/**
 * found: the result is on screen. failed: `error` says why. declined: the
 * person did not agree to send the search, so nothing happened. superseded: a
 * newer search, another organization or leaving the screen made it moot.
 */
export type SearchOutcome = 'found' | 'failed' | 'declined' | 'superseded';

export interface OpportunitySearch {
  /** The last result, kept while the person visits another screen. Null before the first search. */
  snapshot: SearchSnapshot | null;
  searching: boolean;
  /** Why the last search did not finish. Cleared when another starts. */
  error: FundingCallError | null;
  /** The filters of the search that failed, for trying it again. */
  attempted: OpportunityFilters | null;
  run(filters: OpportunityFilters): Promise<SearchOutcome>;
}

const SEARCH_KEY = 'opportunities.search';

export function useOpportunitySearch(runWithConsent: RunWithConsent): OpportunitySearch {
  const [snapshot, setSnapshot] = useScreenState<SearchSnapshot | null>(SEARCH_KEY, null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<FundingCallError | null>(null);
  const [attempted, setAttempted] = useState<OpportunityFilters | null>(null);
  const requests = useRef(0);
  const alive = useAlive();

  const run = useCallback(
    async (filters: OpportunityFilters): Promise<SearchOutcome> => {
      requests.current += 1;
      const request = requests.current;
      const organizationId = currentOrganizationId();
      // The result is written where it outlives this component, so it must
      // still belong: to this visit, to the newest search, and to the
      // organization that asked.
      const wanted = () =>
        alive.current &&
        request === requests.current &&
        currentOrganizationId() === organizationId;

      setSearching(true);
      setError(null);
      setAttempted(filters);
      try {
        const answer = await runWithConsent(() =>
          wanted()
            ? unwrap(fundingBridge().opportunities.search(filters))
            : Promise.reject(new FundingCallError('CANCELLED', 'The search was superseded.')),
        );
        if (!wanted()) return 'superseded';
        const read = readSearchResult(answer);
        if (!read) throw unreadableAnswer();
        setSnapshot({ filters, result: read.result, unreadable: read.unreadable });
        announce(searchAnnouncement(read.result));
        return 'found';
      } catch (caught) {
        if (!wanted()) return 'superseded';
        const failure = toCallError(caught);
        // Declining to send the search is a choice, not a failure.
        if (failure.code === 'CANCELLED') return 'declined';
        setError(failure);
        return 'failed';
      } finally {
        if (alive.current && request === requests.current) setSearching(false);
      }
    },
    [alive, runWithConsent, setSnapshot],
  );

  return useMemo(
    () => ({ snapshot, searching, error, attempted, run }),
    [snapshot, searching, error, attempted, run],
  );
}
