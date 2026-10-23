// One funding listing, as a search result or as a saved listing. The card only
// ever shows what came back from the main process for that listing: its
// status with the reason, the source it was read from and when, and "Not
// stated" wherever the source said nothing.

import { useEffect, useId, useRef, useState, type Ref } from 'react';
import type { Opportunity, OpportunityDetail } from '../../../shared/funding.js';
import {
  NOT_STATED,
  formatDateTime,
  fundingBridge,
  toCallError,
  unwrap,
} from '../../lib/funding-client.js';
import {
  Badge,
  Button,
  Card,
  DefinitionList,
  DefinitionRow,
  Dialog,
  ExternalLink,
  InlineAlert,
  LoadingBlock,
  StatusBadge,
  announce,
  cx,
  layout,
  text,
} from '../ui/index.js';
import { unreadableAnswer, useAlive } from './hooks.js';
import { ListingDetail } from './ListingDetail.js';
import {
  MATCH_NOTE,
  applicantDisplay,
  awardDisplay,
  categoryDisplay,
  deadlineDisplay,
  kindLabel,
  levelDisplay,
  matchDisplay,
  officialLink,
  shortText,
  shownStatus,
} from './listing.js';
import { SavedNote } from './SavedNote.js';
import { useListingServices } from './services.js';
import { readDetail } from './shapes.js';

export interface ListingCardProps {
  opportunity: Opportunity;
  /** "saved" adds when the listing was saved and last re-read, and its note. */
  variant: 'result' | 'saved';
  /** The level of the listing's title: one below the heading it sits under. */
  headingLevel: 3 | 4;
  /** Receives the title, so a link from another screen can put focus on this listing. */
  titleRef?: Ref<HTMLHeadingElement>;
  /** Details already read for this listing, shown open from the start. */
  initialDetail?: OpportunityDetail;
  /** Reads and opens the details as soon as the card appears. */
  openDetailAtOnce?: boolean;
  /** Called once the listing has been removed from the saved list. */
  onRemoved?(): void;
}

type DetailState =
  | { phase: 'idle'; open: false }
  | { phase: 'loading'; open: true }
  | { phase: 'ready'; open: boolean; detail: OpportunityDetail }
  | { phase: 'error'; open: boolean; message: string };

/** How many shared terms are listed by name before the rest are counted. */
const TERMS_SHOWN = 15;

const NOTE_LINE = cx(text.caption, 'mt-0.5 block');

export function ListingCard({
  opportunity,
  variant,
  headingLevel,
  titleRef,
  initialDetail,
  openDetailAtOnce = false,
  onRemoved,
}: ListingCardProps) {
  const services = useListingServices();
  const alive = useAlive();
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const detailId = `${baseId}-detail`;
  const entry = services.savedEntry(opportunity.id);

  const [busy, setBusy] = useState<'save' | 'remove' | 'analyze' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [detail, setDetail] = useState<DetailState>(
    initialDetail
      ? { phase: 'ready', open: true, detail: initialDetail }
      : { phase: 'idle', open: false },
  );

  const status = shownStatus(opportunity);
  const level = levelDisplay(opportunity, services.organizationCountry);
  const deadline = deadlineDisplay(opportunity);
  const award = awardDisplay(opportunity);
  const applicants = applicantDisplay(opportunity);
  const match = matchDisplay(opportunity.match);
  const link = officialLink(opportunity);
  const summary = shortText(opportunity.summary);
  const funder = (opportunity.funder ?? '').trim();
  const sourceName = (opportunity.sourceName ?? '').trim();
  const Title = headingLevel === 3 ? 'h3' : 'h4';

  /** Runs one change to the saved list or the funding documents, showing what main says if it fails. */
  const act = async (kind: 'save' | 'remove' | 'analyze', work: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      if (!alive.current) return;
      const failed = toCallError(error);
      // Declining to send something is a choice, not a failure.
      if (failed.code !== 'CANCELLED') setProblem(failed.message);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const save = () =>
    act('save', async () => {
      const list = await unwrap(fundingBridge().opportunities.save(opportunity));
      if (!alive.current) return;
      services.applySaved(list);
      announce('Listing saved.');
    });

  const remove = () =>
    act('remove', async () => {
      const list = await unwrap(fundingBridge().opportunities.unsave(opportunity.id));
      if (!alive.current) return;
      services.applySaved(list);
      announce('Listing removed from saved.');
      onRemoved?.();
    });

  // A note is the person's own writing and goes with the saved listing, so
  // removing one that has a note is confirmed first. Without a note, removing
  // is undone by saving again.
  const askToRemove = () => {
    if (entry?.note.trim()) setConfirming(true);
    else void remove();
  };

  const analyze = () =>
    act('analyze', async () => {
      const document = await services.runWithConsent(() =>
        unwrap(fundingBridge().rfps.addFromOpportunity(opportunity.id)),
      );
      if (!alive.current) return;
      if (typeof document?.id !== 'string' || !document.id) throw unreadableAnswer();
      services.openAnalysis(document.id);
    });

  const readDetails = async () => {
    if (detail.phase === 'loading') return;
    setDetail({ phase: 'loading', open: true });
    try {
      const answer = readDetail(
        await services.runWithConsent(() =>
          unwrap(fundingBridge().opportunities.detail(opportunity.id)),
        ),
      );
      if (!alive.current) return;
      // Details for another listing must never be shown under this title.
      if (!answer || answer.opportunity.id !== opportunity.id) throw unreadableAnswer();
      setDetail({ phase: 'ready', open: true, detail: answer });
    } catch (error) {
      if (!alive.current) return;
      const failed = toCallError(error);
      setDetail(
        failed.code === 'CANCELLED'
          ? { phase: 'idle', open: false }
          : { phase: 'error', open: true, message: failed.message },
      );
    }
  };

  const toggleDetails = () => {
    if (detail.phase === 'loading') return;
    if (detail.phase === 'idle') void readDetails();
    else setDetail({ ...detail, open: !detail.open });
  };

  // A link from another screen asks for the details to be open on arrival.
  // Read once for the card, however often the effect is run.
  const readNow = useRef(readDetails);
  useEffect(() => {
    readNow.current = readDetails;
  });
  const openedAtOnce = useRef(false);
  useEffect(() => {
    if (!openDetailAtOnce || openedAtOnce.current) return;
    openedAtOnce.current = true;
    void readNow.current();
  }, [openDetailAtOnce]);

  return (
    <Card as="article" padding="lg" aria-labelledby={titleId} className={layout.section}>
      <div className={layout.stack}>
        <div>
          <Title
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className={cx(text.h3, 'break-words')}
          >
            {opportunity.title}
          </Title>
          <p className={cx(text.small, 'mt-0.5 break-words')}>{funder || 'Funder not stated'}</p>
        </div>
        <StatusBadge kind="opportunity" status={status.status} reason={status.reason} />
        <div className={layout.row}>
          <Badge>{kindLabel(opportunity)}</Badge>
          {variant === 'result' && entry && <Badge icon="bookmark">Saved</Badge>}
        </div>
      </div>

      {summary.text && (
        <p className={cx(text.body, layout.prose, 'break-words')}>{summary.text}</p>
      )}

      <DefinitionList>
        <DefinitionRow term="Source">{sourceName || NOT_STATED}</DefinitionRow>
        <DefinitionRow term="Level">
          {level.label}
          {level.geographyNote && <span className={NOTE_LINE}>{level.geographyNote}</span>}
          {level.countsAsInternational && (
            <span className={NOTE_LINE}>
              Counts as international for your organization, because the funder is outside your
              country.
            </span>
          )}
        </DefinitionRow>
        <DefinitionRow term="Deadline">
          {deadline.primary}
          {deadline.secondary && <span className={NOTE_LINE}>{deadline.secondary}</span>}
        </DefinitionRow>
        <DefinitionRow term="Award">
          {award.range}
          {award.total && <span className={NOTE_LINE}>Total available: {award.total}</span>}
        </DefinitionRow>
        <DefinitionRow term="Who may apply">
          {applicants.types}
          {applicants.note && (
            <span className={applicants.types ? NOTE_LINE : undefined}>{applicants.note}</span>
          )}
        </DefinitionRow>
        <DefinitionRow term="Categories">{categoryDisplay(opportunity)}</DefinitionRow>
        <DefinitionRow term="Read from the source">
          {formatDateTime(opportunity.fetchedAt)}
        </DefinitionRow>
        {variant === 'saved' && entry && (
          <>
            <DefinitionRow term="Saved">{formatDateTime(entry.savedAt)}</DefinitionRow>
            <DefinitionRow term="Status last re-read">
              {formatDateTime(entry.recheckedAt)}
            </DefinitionRow>
          </>
        )}
      </DefinitionList>

      {match && (
        <div className={cx(layout.divider, 'flex flex-col gap-2 pt-4')}>
          <p className="text-sm font-medium leading-5 text-ink-inverse">{match.headline}</p>
          {match.terms.length > 0 && (
            <ul aria-label="Shared terms" className="flex flex-wrap gap-1.5">
              {match.terms.slice(0, TERMS_SHOWN).map((term) => (
                <li key={term}>
                  <Badge>{term}</Badge>
                </li>
              ))}
              {match.terms.length > TERMS_SHOWN && (
                <li className={cx(text.caption, 'self-center')}>
                  and {match.terms.length - TERMS_SHOWN} more
                </li>
              )}
            </ul>
          )}
          <p className={text.caption}>
            {match.fields && `The terms come from these parts of your profile: ${match.fields}. `}
            {MATCH_NOTE}
          </p>
        </div>
      )}

      <p className="text-sm leading-5">
        {link.href ? (
          <ExternalLink href={link.href}>{link.label}</ExternalLink>
        ) : (
          <span className={text.small}>No link to the official listing is available.</span>
        )}
      </p>

      <div className={layout.row}>
        {services.canManage &&
          (entry ? (
            <Button
              size="sm"
              icon="bookmark"
              busy={busy === 'remove'}
              busyLabel="Removing the listing from saved"
              aria-describedby={titleId}
              onClick={askToRemove}
            >
              {variant === 'saved' ? 'Remove' : 'Remove from saved'}
            </Button>
          ) : (
            <Button
              size="sm"
              icon="bookmark"
              busy={busy === 'save'}
              busyLabel="Saving the listing"
              aria-describedby={titleId}
              onClick={() => void save()}
            >
              Save
            </Button>
          ))}
        <Button
          size="sm"
          aria-expanded={detail.open}
          aria-controls={detail.open ? detailId : undefined}
          aria-describedby={titleId}
          onClick={toggleDetails}
        >
          Details
        </Button>
        {services.canManage && (
          <Button
            size="sm"
            icon="document"
            busy={busy === 'analyze'}
            busyLabel="Reading the listing from its source"
            aria-describedby={titleId}
            onClick={() => void analyze()}
          >
            Analyze this listing
          </Button>
        )}
      </div>

      {problem && <InlineAlert tone="error">{problem}</InlineAlert>}

      {detail.open && (
        <div id={detailId} className={cx(layout.divider, 'pt-4')}>
          {detail.phase === 'loading' && (
            <LoadingBlock label="Reading the listing from its source" lines={4} />
          )}
          {detail.phase === 'error' && (
            <InlineAlert
              tone="error"
              action={
                <Button size="sm" aria-describedby={titleId} onClick={() => void readDetails()}>
                  Try again
                </Button>
              }
            >
              {detail.message}
            </InlineAlert>
          )}
          {detail.phase === 'ready' && <ListingDetail detail={detail.detail} shown={opportunity} />}
        </div>
      )}

      {variant === 'saved' && entry && <SavedNote entry={entry} titleId={titleId} />}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Remove this saved listing?"
        description="Its note is deleted with it. The listing itself stays on its official source, and you can save it again from a search."
        size="sm"
        primaryAction={{
          label: 'Remove listing',
          variant: 'danger',
          onClick: () => {
            setConfirming(false);
            void remove();
          },
        }}
        secondaryAction={{ label: 'Keep' }}
      />
    </Card>
  );
}
