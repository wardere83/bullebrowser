'use client';

/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { product } from '@bullebrowser/brand-tokens';
import { asset } from '@/lib/asset';
import { useT } from '@/lib/i18n';
import { SECTIONS, useSectionNames, type SectionId } from './sections';

// Dark footer in the Bulle Consulting style: the light wordmark, the tagline
// and what the product is not on the left, a quick-links column on the right,
// and the copyright on a hairline below.
const LINKS: SectionId[] = ['app', 'guides', 'download', 'about', 'privacy'];

export function Footer() {
  const t = useT();
  const { label, lang } = useSectionNames();
  return (
    <footer className="bg-surface-dark text-ink-inverse">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="flex flex-col justify-between gap-8 md:flex-row">
          <div className="max-w-md">
            <Link href="/" className="inline-flex items-center rounded-md">
              <img
                src={asset('/wordmark-light.png')}
                alt={product.name}
                className="h-11 w-auto select-none"
                draggable={false}
              />
            </Link>
            <p className="mt-4 text-sm text-ink-inverse/80">{t('footer.tagline')}</p>
            <p className="mt-3 text-xs leading-relaxed text-ink-inverse/70">
              {t('common.disclaimer')}
            </p>
          </div>
          <nav aria-label={t('nav.footer')}>
            <ul className="flex flex-col gap-2 text-sm">
              {LINKS.map((id) => (
                <li key={id}>
                  <Link
                    href={SECTIONS[id].href}
                    lang={lang}
                    className="text-ink-inverse/80 underline-offset-4 transition-colors hover:text-white hover:underline"
                  >
                    {label(id)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <p className="mt-10 border-t border-white/10 pt-6 text-xs text-ink-inverse/70">
          © {new Date().getFullYear()} {product.vendor}. {t('footer.rights')}
        </p>
      </div>
    </footer>
  );
}
