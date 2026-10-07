import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ORGANIZATION_KIND_LABELS,
  type NewOrganizationInput,
  type Organization,
  type OrganizationKind,
} from '../../shared/funding.js';
import { toCallError } from '../lib/funding-client.js';
import { LOCATION_HINT } from './copy.js';
import {
  EMPTY_ORGANIZATION_VALUES,
  US_REGIONS,
  countryOptions,
  fieldForInvalidInput,
  hasRegionList,
  validateOrganization,
  valuesFromOrganization,
  type OrganizationField,
  type OrganizationFieldErrors,
  type OrganizationFormValues,
} from './organization.js';
import { Button, Field, Fieldset, InlineAlert, Input, RadioGroup, Select } from './ui/index.js';

export interface OrganizationFormProps {
  /** The organization being edited. Leave out to start a new one. */
  organization?: Organization;
  /** Give the form an id when its submit button lives outside it, as in a dialog's footer. */
  id?: string;
  /** Shows the values without letting them be changed. */
  disabled?: boolean;
  /** Renders a submit button under the fields, for a form that stands on its own. */
  submitLabel?: string;
  /** What is read out while the form is being sent. */
  busyLabel?: string;
  /**
   * Receives the input once it has passed the form's own checks. Reject with a
   * FundingCallError to show what main said: on the field it names, or above
   * the form when it names none.
   */
  onSubmit(input: NewOrganizationInput): Promise<void>;
  /** Lets a dialog show its own button as busy. */
  onBusyChange?(busy: boolean): void;
}

const KIND_OPTIONS: { value: OrganizationKind; label: string; description: string }[] = [
  {
    value: 'business',
    label: ORGANIZATION_KIND_LABELS.business,
    description: 'A company that operates for profit.',
  },
  {
    value: 'cbo',
    label: ORGANIZATION_KIND_LABELS.cbo,
    description: 'A nonprofit that serves a local community.',
  },
];

/** The order of the fields on the form: focus goes to the first one that needs attention. */
const FIELD_ORDER: OrganizationField[] = ['name', 'kind', 'country', 'region', 'county', 'city'];

/**
 * The organization's name, type and location. The same form is the first step
 * of onboarding, the "Add an organization" dialog and the "Organization
 * details" dialog, so an organization is described the same way everywhere.
 */
export function OrganizationForm({
  organization,
  id,
  disabled = false,
  submitLabel,
  busyLabel = 'Saving',
  onSubmit,
  onBusyChange,
}: OrganizationFormProps) {
  const [values, setValues] = useState<OrganizationFormValues>(() =>
    organization ? valuesFromOrganization(organization) : EMPTY_ORGANIZATION_VALUES,
  );
  const [errors, setErrors] = useState<OrganizationFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<HTMLInputElement>(null);
  const countryRef = useRef<HTMLSelectElement>(null);
  const regionSelectRef = useRef<HTMLSelectElement>(null);
  const regionInputRef = useRef<HTMLInputElement>(null);
  const countyRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);

  // A successful submit usually removes the form; nothing is set after that.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const regionList = hasRegionList(values.country);
  // A value saved before the list existed is kept as a choice rather than dropped.
  const regionIsListed = US_REGIONS.some((region) => region.code === values.region);

  const change = <F extends OrganizationField>(field: F, value: OrganizationFormValues[F]) => {
    setValues((current) => ({
      ...current,
      [field]: value,
      // A state belongs to its country: changing the country clears it.
      ...(field === 'country' && value !== current.country ? { region: '' } : {}),
    }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const focusField = (field: OrganizationField) => {
    const target = {
      name: nameRef.current,
      kind: kindRef.current,
      country: countryRef.current,
      region: regionSelectRef.current ?? regionInputRef.current,
      county: countyRef.current,
      city: cityRef.current,
    }[field];
    target?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || disabled) return;
    const checked = validateOrganization(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      setFormError(null);
      const first = FIELD_ORDER.find((field) => checked.errors[field]);
      if (first) focusField(first);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    onBusyChange?.(true);
    try {
      await onSubmit(checked.input);
    } catch (error) {
      if (!alive.current) return;
      const failure = toCallError(error);
      const field = failure.code === 'INVALID_INPUT' ? fieldForInvalidInput(failure.message) : null;
      if (field) {
        setErrors({ [field]: failure.message });
        focusField(field);
      } else {
        setFormError(failure.message);
      }
    } finally {
      if (alive.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  };

  return (
    <form
      id={id}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-5"
    >
      {formError && <InlineAlert tone="error">{formError}</InlineAlert>}

      <Field label="Organization name" error={errors.name} required>
        <Input
          ref={nameRef}
          value={values.name}
          onChange={(event) => change('name', event.target.value)}
          disabled={disabled}
          autoComplete="organization"
          maxLength={200}
        />
      </Field>

      <RadioGroup
        label="Organization type"
        options={KIND_OPTIONS}
        value={values.kind}
        onChange={(kind) => change('kind', kind)}
        error={errors.kind}
        disabled={disabled}
        firstOptionRef={kindRef}
        required
      />

      <Fieldset legend="Where it is based" hint={LOCATION_HINT}>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]">
          <Field label="Country" error={errors.country} required>
            <Select
              ref={countryRef}
              value={values.country}
              onChange={(event) => change('country', event.target.value)}
              disabled={disabled}
              autoComplete="country"
            >
              {countryOptions().map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="State or region" error={errors.region} optional>
            {regionList ? (
              <Select
                ref={regionSelectRef}
                value={values.region}
                onChange={(event) => change('region', event.target.value)}
                disabled={disabled}
              >
                <option value="">Not chosen</option>
                {!regionIsListed && values.region && (
                  <option value={values.region}>{values.region}</option>
                )}
                {US_REGIONS.map((region) => (
                  <option key={region.code} value={region.code}>
                    {region.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                ref={regionInputRef}
                value={values.region}
                onChange={(event) => change('region', event.target.value)}
                disabled={disabled}
                autoComplete="address-level1"
              />
            )}
          </Field>

          <Field label="County" error={errors.county} optional>
            <Input
              ref={countyRef}
              value={values.county}
              onChange={(event) => change('county', event.target.value)}
              disabled={disabled}
            />
          </Field>

          <Field label="City" error={errors.city} optional>
            <Input
              ref={cityRef}
              value={values.city}
              onChange={(event) => change('city', event.target.value)}
              disabled={disabled}
              autoComplete="address-level2"
            />
          </Field>
        </div>
      </Fieldset>

      {submitLabel && (
        <div>
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            busyLabel={busyLabel}
            disabled={disabled}
          >
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
