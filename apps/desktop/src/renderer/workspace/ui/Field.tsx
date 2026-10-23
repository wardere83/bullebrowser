import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon } from './icons.js';
import { control, cx, text } from './styles.js';

// What a Field tells the control inside it, so the label, hint and error are
// wired to the control without the screen passing a single id.
interface FieldContextValue {
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function joinIds(...ids: Array<string | undefined | false>): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}

/** The attributes a control takes from the Field around it, if there is one. */
function useFieldControl(own: {
  id?: string;
  describedBy?: string;
  invalid?: boolean;
  required?: boolean;
}) {
  const field = useContext(FieldContext);
  const invalid = own.invalid ?? field?.invalid ?? false;
  return {
    id: own.id ?? field?.controlId,
    'aria-describedby': joinIds(own.describedBy, field?.describedBy),
    'aria-invalid': invalid || undefined,
    'aria-required': (own.required ?? field?.required) || undefined,
    invalid,
  };
}

export interface FieldProps {
  /** The visible label. Every control has one. */
  label: string;
  /** Help that is always shown, under the control. */
  hint?: ReactNode;
  /** What is wrong, in words that say how to fix it. Shown under the control and read out. */
  error?: string | null;
  /** The control must be filled in. Fields are required unless marked optional. */
  required?: boolean;
  /** Adds "(optional)" to the label. */
  optional?: boolean;
  /** One Input, Select or Textarea. */
  children: ReactNode;
  className?: string;
}

/**
 * A labelled control: the label above, one Input, Select or Textarea, then a
 * hint and an error. The control inside is wired up for you (its id, its
 * description and its invalid state), so a screen reader hears the label, then
 * the hint and the error.
 *
 *   <Field label="Organization name" error={errors.name} required>
 *     <Input value={name} onChange={(event) => setName(event.target.value)} />
 *   </Field>
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  children,
  className,
}: FieldProps) {
  const baseId = useId();
  const controlId = `${baseId}-control`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const describedBy = joinIds(hint ? hintId : undefined, error ? errorId : undefined);

  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className={control.label}>
        {label}
        {optional && <span className={control.optional}> (optional)</span>}
      </label>
      <FieldContext.Provider value={{ controlId, describedBy, invalid: Boolean(error), required }}>
        {children}
      </FieldContext.Provider>
      {hint && (
        <p id={hintId} className={control.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className={control.error}>
          <Icon name="alert" size={14} className="mt-px" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export interface FieldsetProps {
  /** Names the group. */
  legend: string;
  /** Help for the group as a whole. */
  hint?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Groups fields that answer one question together, such as the parts of an
 * address, under a legend and an optional hint that applies to all of them.
 */
export function Fieldset({ legend, hint, children, disabled, className }: FieldsetProps) {
  const hintId = useId();
  return (
    <fieldset
      disabled={disabled}
      aria-describedby={hint ? hintId : undefined}
      className={cx('flex min-w-0 flex-col gap-3', className)}
    >
      <legend className={cx(text.h3, 'mb-1')}>{legend}</legend>
      {hint && (
        <p id={hintId} className={control.hint}>
          {hint}
        </p>
      )}
      {children}
    </fieldset>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks the control as invalid when it is used without a Field. */
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/** A single-line text field. Put it inside a Field so it has a visible label. */
export function Input({ invalid, className, id, required, ref, ...rest }: InputProps) {
  const field = useFieldControl({ id, describedBy: rest['aria-describedby'], invalid, required });
  return (
    <input
      type="text"
      {...rest}
      ref={ref}
      id={field.id}
      aria-describedby={field['aria-describedby']}
      aria-invalid={field['aria-invalid']}
      aria-required={field['aria-required']}
      className={cx(
        control.field,
        control.input,
        field.invalid ? control.invalid : control.idle,
        className,
      )}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

/** A native list of choices: `<option>` elements as children. Put it inside a Field. */
export function Select({ invalid, className, id, required, children, ref, ...rest }: SelectProps) {
  const field = useFieldControl({ id, describedBy: rest['aria-describedby'], invalid, required });
  return (
    <div className="relative">
      <select
        {...rest}
        ref={ref}
        id={field.id}
        aria-describedby={field['aria-describedby']}
        aria-invalid={field['aria-invalid']}
        aria-required={field['aria-required']}
        className={cx(
          control.field,
          control.select,
          field.invalid ? control.invalid : control.idle,
          className,
        )}
      >
        {children}
      </select>
      <Icon
        name="chevron-down"
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-inverse/70"
      />
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

/** A text field for more than one line. Put it inside a Field. */
export function Textarea({ invalid, className, id, required, ref, ...rest }: TextareaProps) {
  const field = useFieldControl({ id, describedBy: rest['aria-describedby'], invalid, required });
  return (
    <textarea
      rows={4}
      {...rest}
      ref={ref}
      id={field.id}
      aria-describedby={field['aria-describedby']}
      aria-invalid={field['aria-invalid']}
      aria-required={field['aria-required']}
      className={cx(
        control.field,
        control.textarea,
        field.invalid ? control.invalid : control.idle,
        className,
      )}
    />
  );
}
