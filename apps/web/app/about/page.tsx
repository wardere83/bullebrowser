'use client';

import { product } from '@bullebrowser/brand-tokens';
import { useT } from '@/lib/i18n';

// The About page, as plain prose: who makes BulleBrowser, why it is a browser,
// what it will not do, and why it runs on the user's own key.
export default function AboutPage() {
  const t = useT();
  return (
    <div className="prose-lite mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">{t('about.h1')}</h1>
      <p className="mt-6 text-lg leading-relaxed">{t('about.lead')}</p>

      <h2>{t('about.why.h2')}</h2>
      <p>{t('about.why.p')}</p>

      <h2>{t('about.limits.h2')}</h2>
      <p>{t('about.limits.p')}</p>

      <h2>{t('about.key.h2')}</h2>
      <p>{t('about.key.p')}</p>

      <h2>{t('about.contact.h2')}</h2>
      <p>
        {t('about.contact.p')} <a href={`mailto:${product.contactEmail}`}>{product.contactEmail}</a>
      </p>
    </div>
  );
}
