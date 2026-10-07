'use client';

import { useT } from '@/lib/i18n';
import { Icon } from './Icon';

// The label every example on the site carries. Nothing here is a live funding
// listing, and a visitor must be able to tell that at a glance, from the
// example itself and not only from a heading somewhere above it.
export function SampleLabel({
  tone = 'light',
  className = '',
}: {
  /** `dark` for a label that sits on a dark surface. */
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const t = useT();
  const colours =
    tone === 'dark' ? 'border-white/25 bg-white/10 text-ink-inverse' : 'border-amber-300 bg-amber-50 text-amber-900';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${colours} ${className}`}
    >
      <Icon name="info" className="h-3.5 w-3.5" />
      {t('common.illustration')}
    </span>
  );
}
