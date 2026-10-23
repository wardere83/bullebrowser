'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { Icon } from './Icon';

// An infinite marquee of pills. The list is rendered twice so the loop is
// seamless, and the second copy is hidden from screen readers so nothing is
// read out twice. Each copy ends in padding as wide as the gap between pills:
// that makes the two halves exactly equal, which the half-width loop needs.
//
// Text that moves must be stoppable: the button pauses it, as do hovering and
// keyboard focus. Under reduced motion nothing moves at all and the pills wrap
// onto as many lines as they need (see globals.css).
export function Marquee({ items, label }: { items: string[]; label: string }) {
  const t = useT();
  const [paused, setPaused] = useState(false);

  const pills = items.map((item) => (
    <li
      key={item}
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm text-ink-secondary shadow-sm"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
      {item}
    </li>
  ));

  return (
    <div className="marquee-row flex items-center gap-3 pe-4 sm:pe-6">
      <div className="marquee min-w-0 flex-1 overflow-hidden" data-paused={paused}>
        <div className="marquee-track flex w-max animate-scroll">
          <ul aria-label={label} className="flex gap-3 pe-3">
            {pills}
          </ul>
          <ul aria-hidden="true" className="marquee-copy flex gap-3 pe-3">
            {pills}
          </ul>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        className="marquee-toggle inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-strong bg-white text-ink-primary shadow-sm transition-colors hover:bg-surface-muted"
      >
        <Icon name={paused ? 'play' : 'pause'} />
        <span className="sr-only">{paused ? t('marquee.play') : t('marquee.pause')}</span>
      </button>
    </div>
  );
}
