'use client';

/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { product } from '@bullebrowser/brand-tokens';
import { asset } from '@/lib/asset';
import { TranslationMenu } from './TranslationMenu';

// Dark navigation in the Bulle Consulting brand style: a deep charcoal bar
// (dark-gray #142127) with the light wordmark, white text links that shade on
// hover, and a solid teal Download button as the primary call to action. The
// item for the page you're on carries a persistent white tint. On phones the
// text links fold away (the footer carries them) so the bar never overflows.
const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/features', label: 'Workflows' },
  { href: '/install', label: 'Guides' },
];

export function Header() {
  const pathname = usePathname();
  const onDownload = pathname.startsWith('/download');
  return (
    <header className="sticky top-0 z-30 bg-surface-dark text-ink-inverse">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" aria-label={product.name} className="flex shrink-0 items-center">
          <img
            src={asset('/wordmark-light.png')}
            alt={product.name}
            className="h-9 w-auto select-none sm:h-11"
            draggable={false}
          />
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((l) => {
            const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`hidden rounded-md px-4 py-2 font-medium transition-colors md:inline-flex ${
                  active ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <Link
            href="/download"
            aria-current={onDownload ? 'page' : undefined}
            className="ml-1 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 sm:px-5 font-semibold text-white transition-all duration-300 hover:scale-105 hover:bg-primary-hover"
          >
            Download
          </Link>
          <TranslationMenu dark />
        </nav>
      </div>
    </header>
  );
}
