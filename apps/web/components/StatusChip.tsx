'use client';

import { useT } from '@/lib/i18n';
import { OPPORTUNITY_STATUSES, type OpportunityStatus } from '@/lib/terms';
import { Icon, type IconName } from './Icon';

// How a listing's status is shown: always the word, with an icon whose shape
// goes with it, so the three read apart without colour. The app shows the same
// three with the same icons.
const LOOK: Record<OpportunityStatus, { icon: IconName; colours: string }> = {
  active: { icon: 'check-circle', colours: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  expired: { icon: 'clock', colours: 'border-slate-300 bg-slate-100 text-slate-700' },
  unverified: { icon: 'question', colours: 'border-amber-300 bg-amber-50 text-amber-800' },
};

export function StatusChip({ status }: { status: OpportunityStatus }) {
  const t = useT();
  const { icon, colours } = LOOK[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${colours}`}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
      {t(`status.${status}`)}
    </span>
  );
}

/** The three labels with what each one means, in the app's own terms. */
export function StatusLegend() {
  const t = useT();
  return (
    <dl className="space-y-5">
      {OPPORTUNITY_STATUSES.map((status) => (
        <div key={status} className="flex flex-col gap-2 sm:flex-row sm:gap-5">
          <dt className="sm:w-36 sm:shrink-0">
            <StatusChip status={status} />
          </dt>
          <dd className="text-sm leading-relaxed text-ink-secondary">{t(`status.${status}.d`)}</dd>
        </div>
      ))}
    </dl>
  );
}
