// The search filters. What is most often changed (keyword, level, status) is
// always in view; the rest folds away under a line that says what is chosen,
// so a long form stays short and nothing that narrows a search is hidden.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from 'react';
import {
  APPLICANT_TYPE_LABELS,
  FUNDING_CATEGORY_LABELS,
  GEO_LEVEL_LABELS,
  OPPORTUNITY_KIND_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  type FundingSourceInfo,
  type OpportunityFilters,
  type PlaceFilter,
} from '../../../shared/funding.js';
import type { AsyncResult } from '../../lib/funding-client.js';
import { US_REGIONS, countryOptions, hasRegionList } from '../organization.js';
import {
  Button,
  Card,
  Checkbox,
  ExternalLink,
  Field,
  InlineAlert,
  Input,
  LoadingBlock,
  SectionHeading,
  Select,
  control,
  cx,
  layout,
  text,
} from '../ui/index.js';
import {
  APPLICANT_TYPES,
  CATEGORIES,
  EMPTY_PLACE,
  KINDS,
  KIND_MEANINGS,
  LEVELS,
  MAX_PLACE_LENGTH,
  MAX_QUERY_LENGTH,
  STATUSES,
  STATUS_MEANINGS,
  firstError,
  isPlaceEmpty,
  readDraft,
  samePlace,
  summarizeAmount,
  summarizeChoice,
  summarizeDeadline,
  summarizePlace,
  summarizeSources,
  withChoice,
  type CheckedField,
  type FilterDraft,
  type FilterErrors,
} from './filters.js';
import { ChoiceFieldset, ChoiceGrid, Fold } from './parts.js';
import { knownSourceIds, sourceSummary } from './sources.js';

export interface FilterFormProps {
  draft: FilterDraft;
  onChange(next: FilterDraft): void;
  /** Called with filters that passed the form's own checks. */
  onSearch(filters: OpportunityFilters): void;
  searching: boolean;
  /** What main said was wrong with the filters, when it refused them. */
  refusal: string | null;
  sources: AsyncResult<FundingSourceInfo[]>;
  /** Where the organization is; offered as the place to search from. */
  organizationPlace: PlaceFilter;
  /** Buttons that act on the filters as a whole. */
  actions?: ReactNode;
  /** Something to say under the heading, such as where suggested filters came from. */
  notice?: ReactNode;
  formRef?: Ref<HTMLFormElement>;
}

type GroupId = 'place' | 'applicants' | 'categories' | 'kinds' | 'amount' | 'deadline' | 'sources';

/** The folded group a control with something wrong sits in, if it sits in one. */
const GROUP_OF: Record<CheckedField, GroupId | null> = {
  statuses: null,
  amountMin: 'amount',
  amountMax: 'amount',
  deadlineFrom: 'deadline',
  deadlineTo: 'deadline',
};

const FIELD_GRID = 'grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]';

export function FilterForm({
  draft,
  onChange,
  onSearch,
  searching,
  refusal,
  sources,
  organizationPlace,
  actions,
  notice,
  formRef,
}: FilterFormProps) {
  const headingId = useId();
  const [errors, setErrors] = useState<FilterErrors>({});
  const [open, setOpen] = useState<Record<GroupId, boolean>>({
    place: false,
    applicants: false,
    categories: false,
    kinds: false,
    amount: false,
    deadline: false,
    sources: false,
  });
  const [focusOn, setFocusOn] = useState<CheckedField | null>(null);

  const statusRef = useRef<HTMLInputElement>(null);
  const amountMinRef = useRef<HTMLInputElement>(null);
  const amountMaxRef = useRef<HTMLInputElement>(null);
  const deadlineFromRef = useRef<HTMLInputElement>(null);
  const deadlineToRef = useRef<HTMLInputElement>(null);

  // The control may sit in a group that has only just been opened, so focus
  // moves once the group is on the page.
  useEffect(() => {
    if (!focusOn) return;
    const target = {
      statuses: statusRef,
      amountMin: amountMinRef,
      amountMax: amountMaxRef,
      deadlineFrom: deadlineFromRef,
      deadlineTo: deadlineToRef,
    }[focusOn];
    target.current?.focus();
    setFocusOn(null);
  }, [focusOn]);

  const change = (patch: Partial<FilterDraft>, cleared: readonly CheckedField[] = []) => {
    onChange({ ...draft, ...patch });
    if (cleared.some((field) => errors[field])) {
      setErrors((current) => {
        const next = { ...current };
        for (const field of cleared) delete next[field];
        return next;
      });
    }
  };

  const changePlace = (patch: Partial<PlaceFilter>) =>
    change({
      place: {
        ...draft.place,
        ...patch,
        // A state belongs to its country: changing the country clears it.
        ...(patch.country !== undefined && patch.country !== draft.place.country
          ? { region: '' }
          : {}),
      },
    });

  const toggleGroup = (group: GroupId) => (next: boolean) =>
    setOpen((current) => ({ ...current, [group]: next }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (searching) return;
    const reading = readDraft(draft);
    if (!reading.ok) {
      setErrors(reading.errors);
      const first = firstError(reading.errors);
      const group = first ? GROUP_OF[first] : null;
      if (group) setOpen((current) => ({ ...current, [group]: true }));
      setFocusOn(first);
      return;
    }
    setErrors({});
    onSearch(reading.filters);
  };

  const country = draft.place.country;
  const countries = countryOptions();
  const countryListed = !country || countries.some((option) => option.code === country);
  const regionListed = !draft.place.region || US_REGIONS.some((r) => r.code === draft.place.region);
  const hasOrganizationPlace = !isPlaceEmpty(organizationPlace);

  const sourceList = sources.value ?? [];
  const sourceIds = sourceList.map((source) => source.id);
  // A chosen source the app no longer offers is not counted: it will not be searched.
  const chosenSources = sources.value
    ? knownSourceIds(draft.sourceIds, sourceList)
    : draft.sourceIds;

  return (
    <Card padding="lg">
      <form
        ref={formRef}
        role="search"
        aria-labelledby={headingId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-5"
      >
        <SectionHeading
          level={2}
          id={headingId}
          title="Search official sources"
          description="Set what to look for, then search. Only what the sources return is listed."
          actions={actions}
        />
        {notice}

        <Field
          label="Keyword"
          hint="Words a listing must contain. Leave it empty to list everything the other filters allow."
          optional
        >
          <Input
            value={draft.query}
            onChange={(event) => change({ query: event.target.value })}
            maxLength={MAX_QUERY_LENGTH}
            enterKeyHint="search"
            autoComplete="off"
          />
        </Field>

        <ChoiceFieldset legend="Level" hint="Choose none to include every level.">
          <ChoiceGrid
            options={LEVELS.map((level) => ({ value: level, label: GEO_LEVEL_LABELS[level] }))}
            chosen={draft.levels}
            onToggle={(level, on) => change({ levels: withChoice(draft.levels, level, on, LEVELS) })}
          />
        </ChoiceFieldset>

        <ChoiceFieldset
          legend="Status"
          hint="Every listing is shown with its status and the reason for it."
          error={errors.statuses}
        >
          <ChoiceGrid
            stacked
            firstRef={statusRef}
            options={STATUSES.map((status) => ({
              value: status,
              label: OPPORTUNITY_STATUS_LABELS[status],
              hint: STATUS_MEANINGS[status],
            }))}
            chosen={draft.statuses}
            onToggle={(status, on) =>
              change({ statuses: withChoice(draft.statuses, status, on, STATUSES) }, ['statuses'])
            }
          />
        </ChoiceFieldset>

        <div className={cx(layout.list, 'border-y border-white/10')}>
          <Fold
            title="Place"
            summary={summarizePlace(draft.place)}
            hint="Place narrows citywide, countywide and statewide listings to the place you name. Federal and international listings are not narrowed by it."
            open={open.place}
            onOpenChange={toggleGroup('place')}
          >
            <div className={FIELD_GRID}>
              <Field label="Country">
                <Select
                  value={country}
                  onChange={(event) => changePlace({ country: event.target.value })}
                >
                  <option value="">Any country</option>
                  {!countryListed && <option value={country}>{country}</option>}
                  {countries.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="State or region">
                {hasRegionList(country) ? (
                  <Select
                    value={draft.place.region}
                    onChange={(event) => changePlace({ region: event.target.value })}
                  >
                    <option value="">Any state or territory</option>
                    {!regionListed && (
                      <option value={draft.place.region}>{draft.place.region}</option>
                    )}
                    {US_REGIONS.map((region) => (
                      <option key={region.code} value={region.code}>
                        {region.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={draft.place.region}
                    onChange={(event) => changePlace({ region: event.target.value })}
                    maxLength={MAX_PLACE_LENGTH}
                  />
                )}
              </Field>
              <Field label="County">
                <Input
                  value={draft.place.county}
                  onChange={(event) => changePlace({ county: event.target.value })}
                  maxLength={MAX_PLACE_LENGTH}
                />
              </Field>
              <Field label="City">
                <Input
                  value={draft.place.city}
                  onChange={(event) => changePlace({ city: event.target.value })}
                  maxLength={MAX_PLACE_LENGTH}
                />
              </Field>
            </div>
            <div className={layout.row}>
              <Button
                size="sm"
                disabled={isPlaceEmpty(draft.place)}
                onClick={() => change({ place: { ...EMPTY_PLACE } })}
              >
                Clear place
              </Button>
              {hasOrganizationPlace && !samePlace(draft.place, organizationPlace) && (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => change({ place: { ...organizationPlace } })}
                >
                  Use our organization’s place
                </Button>
              )}
            </div>
          </Fold>

          <Fold
            title="Who may apply"
            summary={summarizeChoice(draft.applicantTypes, APPLICANT_TYPE_LABELS, 'Any applicant')}
            hint="Choose none to include every kind of applicant."
            open={open.applicants}
            onOpenChange={toggleGroup('applicants')}
          >
            <ChoiceGrid
              options={APPLICANT_TYPES.map((type) => ({
                value: type,
                label: APPLICANT_TYPE_LABELS[type],
              }))}
              chosen={draft.applicantTypes}
              onToggle={(type, on) =>
                change({
                  applicantTypes: withChoice(draft.applicantTypes, type, on, APPLICANT_TYPES),
                })
              }
            />
          </Fold>

          <Fold
            title="Funding category"
            summary={summarizeChoice(draft.categories, FUNDING_CATEGORY_LABELS, 'Any category')}
            hint="Choose none to include every category."
            open={open.categories}
            onOpenChange={toggleGroup('categories')}
          >
            <ChoiceGrid
              options={CATEGORIES.map((category) => ({
                value: category,
                label: FUNDING_CATEGORY_LABELS[category],
              }))}
              chosen={draft.categories}
              onToggle={(category, on) =>
                change({ categories: withChoice(draft.categories, category, on, CATEGORIES) })
              }
            />
          </Fold>

          <Fold
            title="Kind of funding"
            summary={summarizeChoice(
              draft.kinds,
              OPPORTUNITY_KIND_LABELS,
              'Grants and contract solicitations',
            )}
            hint="Some city and county sources list contract solicitations rather than grants. Choose none to include both."
            open={open.kinds}
            onOpenChange={toggleGroup('kinds')}
          >
            <ChoiceGrid
              stacked
              options={KINDS.map((kind) => ({
                value: kind,
                label: OPPORTUNITY_KIND_LABELS[kind],
                hint: KIND_MEANINGS[kind],
              }))}
              chosen={draft.kinds}
              onToggle={(kind, on) => change({ kinds: withChoice(draft.kinds, kind, on, KINDS) })}
            />
          </Fold>

          <Fold
            title="Award amount"
            summary={summarizeAmount(draft)}
            hint="Amounts are compared as numbers, in each listing’s own currency."
            open={open.amount}
            onOpenChange={toggleGroup('amount')}
          >
            <div className={FIELD_GRID}>
              <Field label="Smallest award" error={errors.amountMin}>
                <Input
                  ref={amountMinRef}
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={24}
                  value={draft.amountMin}
                  onChange={(event) =>
                    change({ amountMin: event.target.value }, ['amountMin', 'amountMax'])
                  }
                />
              </Field>
              <Field label="Largest award" error={errors.amountMax}>
                <Input
                  ref={amountMaxRef}
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={24}
                  value={draft.amountMax}
                  onChange={(event) =>
                    change({ amountMax: event.target.value }, ['amountMin', 'amountMax'])
                  }
                />
              </Field>
            </div>
            <Checkbox
              label="Include listings that do not state an amount"
              hint="They are shown with “Not stated” where the amount would be."
              checked={draft.includeAmountNotStated}
              onChange={(on) => change({ includeAmountNotStated: on })}
            />
          </Fold>

          <Fold
            title="Deadline"
            summary={summarizeDeadline(draft)}
            hint="Both dates are included. When a range is set, listings whose source gives no deadline date are left out."
            open={open.deadline}
            onOpenChange={toggleGroup('deadline')}
          >
            <div className={FIELD_GRID}>
              <Field label="Deadline from" error={errors.deadlineFrom}>
                <Input
                  ref={deadlineFromRef}
                  type="date"
                  value={draft.deadlineFrom}
                  onChange={(event) =>
                    change({ deadlineFrom: event.target.value }, ['deadlineFrom', 'deadlineTo'])
                  }
                />
              </Field>
              <Field label="Deadline to" error={errors.deadlineTo}>
                <Input
                  ref={deadlineToRef}
                  type="date"
                  value={draft.deadlineTo}
                  onChange={(event) =>
                    change({ deadlineTo: event.target.value }, ['deadlineFrom', 'deadlineTo'])
                  }
                />
              </Field>
            </div>
          </Fold>

          <Fold
            title="Sources"
            summary={summarizeSources(chosenSources.length)}
            hint="Choose none to search every source that covers the levels and place you chose."
            open={open.sources}
            onOpenChange={toggleGroup('sources')}
          >
            {sources.state === 'loading' && (
              <LoadingBlock label="Loading the official sources" lines={3} />
            )}
            {sources.state === 'error' && (
              <InlineAlert
                tone="error"
                action={
                  <Button size="sm" onClick={sources.reload}>
                    Try again
                  </Button>
                }
              >
                {sources.error.message}
              </InlineAlert>
            )}
            {sources.value && sourceList.length === 0 && (
              <p className={text.small}>No official source is available to search.</p>
            )}
            {sourceList.length > 0 && (
              <ul className="flex flex-col gap-4">
                {sourceList.map((source) => (
                  <li key={source.id} className="flex flex-col gap-1">
                    <Checkbox
                      label={source.name}
                      hint={sourceSummary(source)}
                      checked={chosenSources.includes(source.id)}
                      onChange={(on) =>
                        change({ sourceIds: withChoice(chosenSources, source.id, on, sourceIds) })
                      }
                    />
                    <div className="flex flex-col gap-1 pl-[1.625rem]">
                      {source.note?.trim() && <p className={control.hint}>{source.note}</p>}
                      {source.attribution?.trim() && (
                        <p className={control.hint}>{source.attribution}</p>
                      )}
                      {source.homepageUrl?.trim() && (
                        <p className="text-xs leading-4">
                          <ExternalLink href={source.homepageUrl}>Visit {source.name}</ExternalLink>
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Fold>
        </div>

        {refusal && <InlineAlert tone="error">{refusal}</InlineAlert>}

        <div className="flex flex-col gap-2">
          <div className={layout.row}>
            <Button
              type="submit"
              variant="primary"
              icon="search"
              busy={searching}
              busyLabel="Searching the official sources"
            >
              Search official sources
            </Button>
          </div>
          <p className={text.caption}>
            Your keyword and filters are sent to the official sources. Your documents and your
            profile are not.
          </p>
        </div>
      </form>
    </Card>
  );
}
