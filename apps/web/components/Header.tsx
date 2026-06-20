'use client';

/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { product } from '@bullebrowser/brand-tokens';
import { asset } from '@/lib/asset';

const MOBILE_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/preview', label: 'Preview' },
  { href: '/install', label: 'Install' },
  { href: '/download', label: 'Download' },
] as const;

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!headerRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, []);

  return (
    <header ref={headerRef} className="sticky top-0 z-30 border-b border-line bg-surface-light/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label={product.name} className="flex items-center" onClick={() => setMenuOpen(false)}>
          <img
            src={asset('/wordmark.png')}
            alt={product.name}
            height={28}
            className="h-7 w-auto select-none"
            draggable={false}
          />
        </Link>
        <button
          type="button"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          className="rounded-md p-2 text-ink-primary hover:bg-surface-muted sm:hidden"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="sr-only">Toggle navigation</span>
          {menuOpen ? (
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2">
              <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <nav className="hidden items-center gap-4 text-sm sm:flex sm:gap-6">
          <Link href="/features" className="hidden text-ink-secondary hover:text-ink-primary sm:inline">
            Features
          </Link>
          <Link href="/preview" className="text-ink-secondary hover:text-ink-primary">
            Preview
          </Link>
          <Link href="/install" className="hidden text-ink-secondary hover:text-ink-primary sm:inline">
            Install
          </Link>
          <Link
            href="/download"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Download
          </Link>
        </nav>
      </div>
      {menuOpen && (
        <nav id="mobile-nav" className="border-t border-line bg-white sm:hidden">
          <div className="mx-auto flex max-w-6xl flex-col px-6 py-3 text-sm">
            {MOBILE_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="py-2 text-ink-secondary hover:text-ink-primary"
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
