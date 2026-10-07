import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';
import { focusableWithin, isDisplayed, restoreFocus } from './focus.js';
import { cx, floating, surface, text } from './styles.js';

export interface DialogAction {
  label: string;
  /** What the button does. Leave it out for a secondary action that only dismisses. */
  onClick?(): void;
  /** The id of a `<form>` in the dialog: the button submits it instead of calling `onClick`. */
  form?: string;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
}

export interface DialogProps {
  open: boolean;
  /** Called by Escape, by the dismiss button, and by a secondary action without its own `onClick`. */
  onClose(): void;
  /** Says what the dialog is for. Rendered as its heading and used as its accessible name. */
  title: string;
  /** A sentence or two under the title; read out when the dialog opens. */
  description?: ReactNode;
  /** The dialog's content: a form, a warning, a list. */
  children?: ReactNode;
  /** The action the dialog exists for. `variant: 'danger'` when it deletes something. */
  primaryAction?: DialogAction & { variant?: 'primary' | 'danger' };
  /** The way out that changes nothing. Name it for what it keeps: "Not now", "Keep organization". */
  secondaryAction?: DialogAction;
  size?: 'sm' | 'md' | 'lg';
  /** Set to false while leaving would lose work under way; Escape and the dismiss button then do nothing. */
  dismissable?: boolean;
}

const WIDTH = { sm: 'max-w-[25rem]', md: 'max-w-[32.5rem]', lg: 'max-w-[42.5rem]' } as const;

/**
 * A modal dialog for one decision or one short form that needs the user's full
 * attention: confirming a deletion, adding an organization. It dims the whole
 * app, moves focus inside (to the first field, or else to the secondary
 * action), keeps Tab inside, closes on Escape and puts focus back where it was.
 *
 * Use it sparingly. Anything a person may want to read alongside the screen
 * belongs on the screen. Dialogs do not nest.
 */
export function Dialog(props: DialogProps) {
  if (!props.open) return null;
  return <DialogSurface {...props} />;
}

function DialogSurface({
  onClose,
  title,
  description,
  children,
  primaryAction,
  secondaryAction,
  size = 'md',
  dismissable = true,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // The listeners below live as long as the dialog; they read the latest props here.
  const latest = useRef({ onClose, dismissable });
  useEffect(() => {
    latest.current = { onClose, dismissable };
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) {
      const body = panel.querySelector('[data-dialog-body]');
      const footer = panel.querySelector('[data-dialog-footer]');
      const target =
        (body ? focusableWithin(body)[0] : undefined) ??
        (footer ? focusableWithin(footer)[0] : undefined) ??
        panel;
      target.focus();
    }

    // The dialog can be on the page without being shown (the workspace is
    // hidden while a web page is in front); it must not hold focus then.
    const shownPanel = () => {
      const current = panelRef.current;
      return current && isDisplayed(current) ? current : null;
    };

    const onFocusIn = (event: FocusEvent) => {
      const current = shownPanel();
      if (!current) return;
      if (event.target instanceof Node && current.contains(event.target)) return;
      (focusableWithin(current)[0] ?? current).focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const current = shownPanel();
      if (!current) return;
      if (event.key === 'Escape') {
        if (!latest.current.dismissable) return;
        event.preventDefault();
        latest.current.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableWithin(current);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        current.focus();
        return;
      }
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !current.contains(active);
      if (event.shiftKey && (active === first || active === current || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
      restoreFocus(previous);
    };
  }, []);

  return (
    <div
      className={cx(
        'fixed inset-0 z-[60] grid place-items-center overflow-y-auto p-4',
        surface.scrim,
      )}
      // A click on the dimmed area must not pull focus out of the dialog.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cx(floating.outer, 'w-full', WIDTH[size])}
      >
        <div className={cx(floating.inner, 'flex max-h-[min(85vh,44rem)] flex-col')}>
          <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
            <div className="min-w-0">
              <h2 id={titleId} className={cx(text.h2, 'break-words')}>
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className={cx(text.small, 'mt-1')}>
                  {description}
                </p>
              )}
            </div>
            <IconButton
              label="Close dialog"
              icon="x"
              size="sm"
              disabled={!dismissable}
              onClick={onClose}
              className="-mr-1.5 -mt-0.5"
            />
          </div>
          {children && (
            <div data-dialog-body className="selectable min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {children}
            </div>
          )}
          {(primaryAction || secondaryAction) && (
            <div
              data-dialog-footer
              className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-3"
            >
              {secondaryAction && (
                <Button
                  variant="secondary"
                  type={secondaryAction.form ? 'submit' : 'button'}
                  form={secondaryAction.form}
                  busy={secondaryAction.busy}
                  busyLabel={secondaryAction.busyLabel}
                  disabled={secondaryAction.disabled}
                  onClick={secondaryAction.form ? undefined : (secondaryAction.onClick ?? onClose)}
                >
                  {secondaryAction.label}
                </Button>
              )}
              {primaryAction && (
                <Button
                  variant={primaryAction.variant ?? 'primary'}
                  type={primaryAction.form ? 'submit' : 'button'}
                  form={primaryAction.form}
                  busy={primaryAction.busy}
                  busyLabel={primaryAction.busyLabel}
                  disabled={primaryAction.disabled}
                  onClick={primaryAction.form ? undefined : primaryAction.onClick}
                >
                  {primaryAction.label}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
