'use client';

// Client-side translation for a statically exported site.
//
// The locale lives in localStorage rather than in the URL, because
// `output: 'export'` gives us no server to negotiate a locale per request. The
// exported HTML is therefore always English; the provider switches language,
// and the document's lang and dir, once the page is running.
//
// Each language is one file in lib/locales, typed against the English one, so
// the five key sets cannot drift apart without failing the build.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ar } from '@/lib/locales/ar';
import { en, type MessageKey, type Messages } from '@/lib/locales/en';
import { es419 } from '@/lib/locales/es-419';
import { fr } from '@/lib/locales/fr';
import { ptPT } from '@/lib/locales/pt-PT';

export type { MessageKey } from '@/lib/locales/en';

export const LOCALES = ['en', 'fr', 'ar', 'es-419', 'pt-PT'] as const;
export type Locale = (typeof LOCALES)[number];
export const STORAGE_KEY = 'bullebrowser:lang';

export interface Language {
  code: Locale;
  /** The language's own name for itself. */
  label: string;
  flag: string;
  dir: 'ltr' | 'rtl';
}

export const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸', dir: 'ltr' },
  { code: 'fr', label: 'Français', flag: '🇫🇷', dir: 'ltr' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦', dir: 'rtl' },
  // Latin American Spanish: the variety the great majority of the world's
  // Spanish speakers use, and neutral across the region.
  { code: 'es-419', label: 'Español', flag: '🇲🇽', dir: 'ltr' },
  // European Portuguese as the formal standard, readable to speakers in
  // Portugal, Brazil and lusophone Africa alike.
  { code: 'pt-PT', label: 'Português', flag: '🇵🇹', dir: 'ltr' },
] as const satisfies readonly Language[];

const DICTS: Record<Locale, Messages> = { en, fr, ar, 'es-419': es419, 'pt-PT': ptPT };

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

function languageOf(locale: Locale): Language {
  return LANGUAGES.find((language) => language.code === locale) ?? LANGUAGES[0];
}

const LocaleContext = createContext<{ locale: Locale; setLocale: (next: Locale) => void }>({
  locale: 'en',
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // Read after the first render, which has to match the exported English HTML.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(saved)) setLocaleState(saved);
    } catch {
      // Storage can be blocked; the site then simply opens in English.
    }
  }, []);

  // Assistive technology and the browser read the language and direction here.
  useEffect(() => {
    const language = languageOf(locale);
    document.documentElement.lang = language.code;
    document.documentElement.dir = language.dir;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still holds for this visit.
    }
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export type Translate = (key: MessageKey) => string;

/** Translates a key into the visitor's language. */
export function useT(): Translate {
  const { locale } = useLocale();
  return useCallback((key: MessageKey) => DICTS[locale][key], [locale]);
}

/**
 * The `lang` to put on text that stays in English whatever the page language
 * is, such as a name the app shows on screen, so that a screen reader
 * pronounces it as English. Undefined while the page itself is English.
 */
export function useEnglishLang(): 'en' | undefined {
  const { locale } = useLocale();
  return locale === 'en' ? undefined : 'en';
}
