import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './icons.js';
import { rovingIndex } from './roving.js';
import { cx, floating, menu as styles } from './styles.js';

export interface MenuItem {
  id: string;
  label: string;
  /** A short second line. */
  description?: string;
  icon?: IconName;
  /** "choice" is one of a set of alternatives, with `checked` marking the current one. */
  kind?: 'action' | 'choice';
  checked?: boolean;
  disabled?: boolean;
  /** "danger" for an item that leads to deleting something. */
  tone?: 'default' | 'danger';
  onSelect(): void;
}

export interface MenuSection {
  id: string;
  /** A small heading above the items. */
  label?: string;
  items: readonly MenuItem[];
}

export interface MenuProps {
  /** Names the menu for assistive technology. */
  label: string;
  /** What the button that opens the menu shows. */
  trigger: ReactNode;
  /** The button's accessible name, when what it shows would not say enough on its own. */
  triggerLabel?: string;
  triggerClassName?: string;
  sections: readonly MenuSection[];
  /** Which edge of the button the menu lines up with. */
  align?: 'start' | 'end';
  /** Width of the menu, in pixels. */
  width?: number;
  className?: string;
}

function itemsOf(list: HTMLElement | null): HTMLElement[] {
  return Array.from(list?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? []);
}

function isEnabled(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') !== 'true';
}

/**
 * A button that opens a short list of actions or choices. The list has menu
 * semantics: the arrow keys, Home and End move between items, typing a letter
 * jumps to the next item that starts with it, Enter chooses, and Escape, Tab
 * or a click elsewhere closes it and returns focus to the button.
 *
 * Use it for a handful of actions on one thing. It is not a way to navigate
 * between screens and not a replacement for Select in a form.
 */
export function Menu({
  label,
  trigger,
  triggerLabel,
  triggerClassName,
  sections,
  align = 'start',
  width = 264,
  className,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<'first' | 'last'>('first');

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const elements = itemsOf(listRef.current).filter(isEnabled);
    const target = focusOnOpen.current === 'last' ? elements[elements.length - 1] : elements[0];
    target?.focus();
    focusOnOpen.current = 'first';

    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    focusOnOpen.current = event.key === 'ArrowUp' ? 'last' : 'first';
    setOpen(true);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // Handled here, so a dialog the menu sits in does not close as well.
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      // Focus goes back to the button first; Tab then moves on from there.
      close(true);
      return;
    }
    const elements = itemsOf(listRef.current);
    const current = elements.findIndex((element) => element === document.activeElement);
    const next = rovingIndex(event.key, current, elements.map(isEnabled), 'vertical');
    if (next !== null) {
      event.preventDefault();
      elements[next]?.focus();
      return;
    }
    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.key !== ' '
    ) {
      const letter = event.key.toLowerCase();
      const order = [...elements.slice(current + 1), ...elements.slice(0, current + 1)];
      order
        .find(
          (element) =>
            isEnabled(element) &&
            (element.dataset.menuLabel ?? '').toLowerCase().startsWith(letter),
        )
        ?.focus();
    }
  };

  return (
    <div ref={rootRef} className={cx('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={cx(
            floating.outer,
            'absolute top-full z-30 mt-1 max-w-[calc(100vw-2rem)]',
            align === 'end' ? 'right-0' : 'left-0',
          )}
          style={{ width }}
        >
          <div
            ref={listRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            className={cx(floating.inner, 'max-h-[min(70vh,28rem)] overflow-y-auto p-1.5')}
          >
            {sections.map((section, sectionIndex) => (
              <div
                key={section.id}
                role="group"
                aria-label={section.label}
                className={cx(sectionIndex > 0 && 'mt-1.5 border-t border-white/10 pt-1.5')}
              >
                {section.label && (
                  <div aria-hidden="true" className={styles.groupLabel}>
                    {section.label}
                  </div>
                )}
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role={item.kind === 'choice' ? 'menuitemradio' : 'menuitem'}
                    aria-checked={item.kind === 'choice' ? Boolean(item.checked) : undefined}
                    aria-disabled={item.disabled || undefined}
                    data-menu-item=""
                    data-menu-label={item.label}
                    tabIndex={-1}
                    onClick={() => {
                      if (item.disabled) return;
                      // Focus is back on the button before the item acts, so
                      // whatever it opens can return focus there afterwards.
                      close(true);
                      item.onSelect();
                    }}
                    className={cx(styles.item, item.tone === 'danger' && styles.danger)}
                  >
                    {item.icon && <Icon name={item.icon} className="mt-0.5" />}
                    <span className="min-w-0 flex-1">
                      <span className="block break-words">{item.label}</span>
                      {item.description && (
                        <span className="block text-xs leading-4 text-ink-inverse/60">
                          {item.description}
                        </span>
                      )}
                    </span>
                    {item.kind === 'choice' && item.checked && (
                      <Icon name="check" className="mt-0.5 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
