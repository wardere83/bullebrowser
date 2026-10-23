'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { product } from '@bullebrowser/brand-tokens';
import { asset } from '@/lib/asset';
import { useT } from '@/lib/i18n';
import { Icon } from './Icon';
import { SECTIONS, isCurrent, useSectionNames, type SectionId } from './sections';
import { TranslationMenu } from './TranslationMenu';

// Dark navigation in the Bulle Consulting brand style: a deep charcoal bar
// with the light wordmark, text links that shade on hover, and a solid teal
// Download button as the primary call to action. The item for the page you are
// on carries a persistent tint and aria-current.
//
// From the md breakpoint up the section links sit in the bar. Below it they
// fold into a menu opened by a button, so every section stays reachable on a
// phone and at high zoom. Below 360px the Download button folds away too (the
// menu still lists it), so the bar fits a 320px-wide view; at 360px the
// wordmark, the button, the language control and the menu button come to about
// 345px. Check that sum again if a label here gets longer.
const BAR_LINKS: SectionId[] = ['home', 'app', 'guides'];
const MENU_LINKS: SectionId[] = ['home', 'app', 'guides', 'download', 'about', 'privacy'];

export function Header() {
  const pathname = usePathname();
  const t = useT();
  const { label, lang } = useSectionNames();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);

  // Following a link in the menu closes it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-30 bg-surface-dark text-ink-inverse">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-primary"
      >
        {t('nav.skip')}
      </a>
      <nav aria-label={t('nav.main')}>
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center rounded-md">
            <img
              src={asset('/wordmark-light.png')}
              alt={product.name}
              className="h-9 w-auto select-none sm:h-11"
              draggable={false}
            />
          </Link>

          <div className="flex items-center gap-1 text-sm">
            <ul className="hidden items-center gap-1 md:flex">
              {BAR_LINKS.map((id) => {
                const current = isCurrent(pathname, id);
                return (
                  <li key={id}>
                    <Link
                      href={SECTIONS[id].href}
                      lang={lang}
                      aria-current={current ? 'page' : undefined}
                      className={`inline-flex rounded-md px-4 py-2 font-medium transition-colors ${
                        current
                          ? 'bg-white/10 text-white'
                          : 'text-white/80 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {label(id)}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Link
              href={SECTIONS.download.href}
              lang={lang}
              aria-current={isCurrent(pathname, 'download') ? 'page' : undefined}
              className="ms-1 hidden items-center justify-center rounded-lg bg-primary px-3 py-2.5 font-semibold text-ink-primary transition-all duration-300 hover:scale-105 hover:bg-primary-hover min-[360px]:inline-flex sm:px-5"
            >
              {label('download')}
            </Link>
            <TranslationMenu dark />
            <button
              ref={toggle}
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls={menuId}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white md:hidden"
            >
              <Icon name={open ? 'close' : 'menu'} className="h-5 w-5" />
              <span className="sr-only">{open ? t('nav.menu.close') : t('nav.menu.open')}</span>
            </button>
          </div>
        </div>

        {/* No display utility below md, so the hidden attribute decides. */}
        <ul
          id={menuId}
          hidden={!open}
          className="border-t border-white/10 px-4 pb-4 pt-2 md:hidden"
        >
          {MENU_LINKS.map((id) => {
            const current = isCurrent(pathname, id);
            return (
              <li key={id}>
                <Link
                  href={SECTIONS[id].href}
                  lang={lang}
                  aria-current={current ? 'page' : undefined}
                  className={`block rounded-md px-3 py-3 text-base font-medium transition-colors ${
                    current
                      ? 'bg-white/10 text-white'
                      : 'text-white/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {label(id)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
