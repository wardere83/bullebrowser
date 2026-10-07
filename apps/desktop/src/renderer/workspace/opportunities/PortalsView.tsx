// The Official portals view: a directory of official funding sites for the
// places and funders BulleBrowser cannot search itself. Every entry is a link
// to a site a person visits; none of them is a listing, and the view says so
// before anything else.

import { useEffect, useId, useMemo, useRef } from 'react';
import {
  GEO_LEVEL_LABELS,
  type GeoLevel,
  type OfficialPortal,
  type Organization,
} from '../../../shared/funding.js';
import { fundingBridge, pluralize, unwrap, useAsync } from '../../lib/funding-client.js';
import { useScreenState } from '../../state/workspace-store.js';
import { useWorkspaceLayout } from '../layout.js';
import { countryName } from '../organization.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ExternalLink,
  Field,
  InlineAlert,
  LoadingBlock,
  SectionHeading,
  Select,
  announce,
  cx,
  layout,
  text,
} from '../ui/index.js';
import { LEVELS } from './filters.js';
import { unreadableAnswer } from './hooks.js';
import {
  PORTAL_LEVEL_LABELS,
  checkedSentence,
  countryApplies,
  countryChoices,
  defaultPortalChoice,
  groupByLevel,
  hasLocalSites,
  mergePortals,
  missingLocalSentence,
  portalCountSentence,
  portalQueries,
  regionApplies,
  regionChoices,
  regionName,
  resolveRegion,
  sameChoice,
  type PortalChoice,
  type PortalLevel,
} from './portals.js';
import { readPortals } from './shapes.js';

const CHOICE_KEY = 'opportunities.portals';
const NO_PORTALS: OfficialPortal[] = [];

/** The sites for a choice, or the whole directory when no choice is given. */
async function askForPortals(choice?: PortalChoice): Promise<OfficialPortal[]> {
  const queries = choice ? portalQueries(choice) : [{}];
  const answers = await Promise.all(
    queries.map(async (filter) => {
      const list = readPortals(await unwrap(fundingBridge().opportunities.portals(filter)));
      if (!list) throw unreadableAnswer();
      return list;
    }),
  );
  return mergePortals(answers);
}

export interface PortalsViewProps {
  organization: Organization | null;
}

export function PortalsView({ organization }: PortalsViewProps) {
  const { columns } = useWorkspaceLayout();
  const headingId = useId();

  // The whole directory, once, for the lists of countries and regions that
  // have sites. What is shown is asked for separately, with the choice made.
  const directory = useAsync(() => askForPortals(), []);
  const known = directory.value ?? NO_PORTALS;

  const organizationCountry = organization?.location.country ?? '';
  const organizationRegion = organization?.location.region ?? '';
  const [chosen, setChosen] = useScreenState<PortalChoice | null>(CHOICE_KEY, null);
  // Until the person chooses, the directory starts from the organization's
  // place, with its region matched to the directory's code once that is known.
  const start = useMemo<PortalChoice>(() => {
    const place = defaultPortalChoice({
      country: organizationCountry,
      region: organizationRegion,
      county: '',
      city: '',
    });
    return { ...place, region: resolveRegion(known, place.country, place.region) };
  }, [known, organizationCountry, organizationRegion]);
  const choice = chosen ?? start;

  const listing = useAsync(
    () => askForPortals(choice),
    [choice.level, choice.country, choice.region],
  );

  // A change made with the controls is answered out loud; the first list is
  // not, because opening the view has already been announced.
  const changed = useRef(false);
  const shown = listing.state === 'ready' ? listing.value : null;
  useEffect(() => {
    if (!shown || !changed.current) return;
    changed.current = false;
    announce(portalCountSentence(shown.length));
  }, [shown]);

  const show = (next: PortalChoice | null) => {
    // Only a choice that changes what is listed has an answer to read out.
    changed.current = !sameChoice(next ?? start, choice);
    setChosen(next);
  };
  const choose = (patch: Partial<PortalChoice>) =>
    show({
      ...choice,
      ...patch,
      // A state or region belongs to its country.
      ...(patch.country !== undefined && patch.country !== choice.country ? { region: '' } : {}),
    });

  const countries = countryChoices(known, choice.country);
  const regions = regionChoices(known, choice.country, choice.region);
  const usesCountry = countryApplies(choice.level);
  const usesRegion = regionApplies(choice.level) && Boolean(choice.country);
  const placeName = choice.region
    ? regionName(known, choice.country, choice.region)
    : choice.country
      ? countryName(choice.country)
      : '';
  const isDefault = !chosen;

  return (
    <section aria-labelledby={headingId} className={layout.section}>
      <SectionHeading
        level={2}
        id={headingId}
        title="Official portals"
        description="Official funding sites for the places and funders BulleBrowser cannot search itself."
      />

      <InlineAlert tone="info" title="These are links, not listings.">
        Each entry opens an official site in a new tab. BulleBrowser does not read listings from
        these sites, so nothing here says that funding is open. Check each site yourself.
      </InlineAlert>

      <Card padding="lg" className={layout.stack}>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]">
          <Field label="Level">
            <Select
              value={choice.level}
              onChange={(event) => choose({ level: event.target.value as PortalLevel })}
            >
              <option value="all">{PORTAL_LEVEL_LABELS.all}</option>
              {LEVELS.map((level) => (
                <option key={level} value={level}>
                  {GEO_LEVEL_LABELS[level]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Country"
            hint={usesCountry ? undefined : 'International sites are listed for every country.'}
          >
            <Select
              value={choice.country}
              disabled={!usesCountry}
              onChange={(event) => choose({ country: event.target.value })}
            >
              <option value="">All countries</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="State or region"
            hint={
              !regionApplies(choice.level)
                ? 'Federal and international sites are not tied to a state or region.'
                : !choice.country
                  ? 'Choose a country to pick one of its states or regions.'
                  : undefined
            }
          >
            <Select
              value={choice.region}
              disabled={!usesRegion}
              onChange={(event) => choose({ region: event.target.value })}
            >
              <option value="">All states and regions</option>
              {regions.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {choice.level === 'all' && choice.country && (
          <p className={text.caption}>
            Federal and international sites are listed whichever state or region is chosen.
          </p>
        )}
        {!isDefault && (
          <div>
            <Button size="sm" variant="quiet" onClick={() => show(null)}>
              Show our organization’s place
            </Button>
          </div>
        )}
        {directory.state === 'error' && (
          <InlineAlert
            tone="caution"
            action={
              <Button size="sm" onClick={directory.reload}>
                Try again
              </Button>
            }
          >
            The lists of countries and regions could not be loaded, so only the current choice is
            offered. {directory.error.message}
          </InlineAlert>
        )}
      </Card>

      {listing.state === 'loading' && <LoadingBlock label="Loading official sites" lines={5} />}

      {listing.state === 'error' && (
        <InlineAlert
          tone="error"
          action={
            <Button size="sm" onClick={listing.reload}>
              Try again
            </Button>
          }
        >
          {listing.error.message}
        </InlineAlert>
      )}

      {listing.state === 'ready' && (
        <>
          {listing.value.length === 0 ? (
            <Card padding="lg">
              <EmptyState
                icon="list"
                title="No official sites are listed for this choice"
                body="Try another level, or choose all states and regions."
              />
            </Card>
          ) : (
            <>
              <p className={text.body}>{portalCountSentence(listing.value.length)}</p>
              {choice.level === 'all' && choice.region && !hasLocalSites(listing.value) && (
                <InlineAlert tone="info">{missingLocalSentence(placeName)}</InlineAlert>
              )}
              {groupByLevel(listing.value).map((group) => (
                <PortalGroup
                  key={group.level}
                  level={group.level}
                  portals={group.portals}
                  columns={columns}
                />
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}

function PortalGroup({
  level,
  portals,
  columns,
}: {
  level: GeoLevel;
  portals: readonly OfficialPortal[];
  columns: 1 | 2 | 3;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={layout.section}>
      <SectionHeading
        level={3}
        id={headingId}
        title={GEO_LEVEL_LABELS[level]}
        addon={<Badge>{pluralize(portals.length, 'site')}</Badge>}
      />
      <ul
        className="grid gap-x-8 border-t border-white/10"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {portals.map((portal) => (
          <PortalEntry key={portal.id} portal={portal} />
        ))}
      </ul>
    </section>
  );
}

function PortalEntry({ portal }: { portal: OfficialPortal }) {
  const operator = (portal.operator ?? '').trim();
  const jurisdiction = (portal.jurisdiction ?? '').trim();
  const notes = (portal.notes ?? '').trim();
  return (
    <li className="flex min-w-0 flex-col gap-1.5 border-b border-white/10 py-3.5">
      <p className="text-sm font-medium leading-5">
        <ExternalLink href={portal.url}>{portal.name}</ExternalLink>
      </p>
      <p className={text.small}>
        {operator ? `Run by ${operator}. ` : ''}
        {jurisdiction ? `Covers ${jurisdiction}. ` : ''}
        {GEO_LEVEL_LABELS[portal.level] ?? portal.level}.
      </p>
      {notes && <p className={cx(text.small, 'break-words')}>{notes}</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={text.caption}>{checkedSentence(portal)}</span>
        {portal.reachable === false && (
          <Badge tone="caution" icon="alert">
            Could not be checked automatically
          </Badge>
        )}
      </div>
      {portal.reachable === false && (
        <p className={text.caption}>
          The site turned the automated check away. The link may still open in your browser.
        </p>
      )}
    </li>
  );
}
