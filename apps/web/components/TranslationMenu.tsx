'use client';

// The Translation control in the top bar. It shows just the active language's
// flag and a chevron — no label, no ticker — and opens a list of languages,
// each named in its own language. The accessible name stays "Translation",
// fixed in every language like the section names beside it.
//
// It is a plain disclosure: a button that shows and hides a list of buttons.
// Tab moves through the list, Escape closes it, and focus returns to the
// button, so it works the same with a keyboard as with a pointer.

import { useEffect, useId, useRef, useState } from 'react';
import { LANGUAGES, useLocale, type Locale } from '@/lib/i18n';
import { Icon } from './Icon';

export function TranslationMenu({ dark = false }: { dark?: boolean } = {}) {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const active = LANGUAGES.find((language) => language.code === locale) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (code: Locale) => {
    setLocale(code);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      ref={wrap}
      className="relative"
      onBlur={(event) => {
        // Tabbing out of the list closes it. A click that moves focus nowhere
        // is left to the pointer handler above, so a click on a language is
        // not cancelled by the list closing under it.
        const next = event.relatedTarget;
        if (next && !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Translation"
        lang="en"
        className={`flex h-10 items-center gap-1.5 rounded-md px-2 text-sm transition-colors ${
          dark ? 'text-white/80 hover:bg-white/10 hover:text-white' : 'text-ink-secondary hover:text-ink-primary'
        }`}
      >
        <span className="text-base leading-none" aria-hidden="true">
          {active.flag}
        </span>
        <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <ul
        id={listId}
        hidden={!open}
        className="absolute end-0 top-full z-50 mt-2 max-h-80 w-52 overflow-y-auto rounded-xl border border-line bg-surface-light p-1 shadow-xl"
      >
        {LANGUAGES.map((language) => {
          const current = language.code === active.code;
          return (
            <li key={language.code}>
              <button
                type="button"
                onClick={() => choose(language.code)}
                aria-current={current ? 'true' : undefined}
                lang={language.code}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm transition-colors ${
                  current
                    ? 'bg-primary/10 font-semibold text-ink-primary'
                    : 'text-ink-primary hover:bg-surface-muted'
                }`}
              >
                <span className="text-base" aria-hidden="true">
                  {language.flag}
                </span>
                <span className="flex-1">{language.label}</span>
                {current && <Icon name="check" className="h-4 w-4" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
