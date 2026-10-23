import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { rovingIndex } from './roving.js';
import { cx, tabs as styles } from './styles.js';

export interface TabSpec<T extends string = string> {
  id: T;
  label: string;
  /** A small count after the label, for example the number of items waiting. */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  /** Unique on the screen; ties each tab to its panel. Use the same value on TabPanel. */
  id: string;
  /** Names the set of tabs for assistive technology. */
  label: string;
  tabs: readonly TabSpec<T>[];
  /** The id of the tab that is showing. */
  value: T;
  onChange(id: T): void;
  className?: string;
}

export function tabElementId(tabsId: string, tab: string): string {
  return `${tabsId}-tab-${tab}`;
}

export function tabPanelId(tabsId: string, tab: string): string {
  return `${tabsId}-panel-${tab}`;
}

/**
 * Switches between views of the same thing on one screen (a funding document's
 * analysis and its alignment, a library and its profile). One tab is in the
 * tab order; the arrow keys, Home and End move between tabs and show the tab
 * they land on. Render the content of the current tab in a TabPanel with the
 * same `id`. Do not use tabs for moving between screens: that is navigation.
 */
export function Tabs<T extends string>({
  id,
  label,
  tabs,
  value,
  onChange,
  className,
}: TabsProps<T>) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((tab) => tab.id === value);
    const next = rovingIndex(
      event.key,
      current,
      tabs.map((tab) => !tab.disabled),
      'horizontal',
    );
    const target = next === null ? undefined : tabs[next];
    if (!target) return;
    event.preventDefault();
    buttons.current.get(target.id)?.focus();
    if (target.id !== value) onChange(target.id);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx(styles.list, className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) buttons.current.set(tab.id, element);
              else buttons.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={tabElementId(id, tab.id)}
            aria-selected={selected}
            // Only the current tab has a panel on the page to point at.
            aria-controls={selected ? tabPanelId(id, tab.id) : undefined}
            aria-disabled={tab.disabled || undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!tab.disabled && !selected) onChange(tab.id);
            }}
            className={cx(
              styles.tab,
              tab.disabled ? styles.disabled : selected ? styles.selected : styles.idle,
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span className="rounded-full bg-white/[0.08] px-1.5 text-[11px] leading-4 text-ink-inverse/85">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  /** The `id` given to the Tabs this panel belongs to. */
  tabsId: string;
  /** The id of the tab this panel shows. */
  tab: string;
  children: ReactNode;
  className?: string;
}

/**
 * The content of the current tab. Render one, for the tab that is showing; it
 * is named after its tab and can be reached with Tab straight after the tabs.
 */
export function TabPanel({ tabsId, tab, children, className }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(tabsId, tab)}
      aria-labelledby={tabElementId(tabsId, tab)}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}
