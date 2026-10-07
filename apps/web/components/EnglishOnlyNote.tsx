'use client';

import { useLocale, useT } from '@/lib/i18n';

// The privacy policy is legal text and is published in English only, to be
// translated with review rather than in passing. A visitor reading the site in
// another language is told so, in that language, before the policy begins.
export function EnglishOnlyNote() {
  const t = useT();
  const { locale } = useLocale();
  if (locale === 'en') return null;
  return (
    <p className="mb-8 rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm text-ink-secondary">
      {t('privacy.english')}
    </p>
  );
}
