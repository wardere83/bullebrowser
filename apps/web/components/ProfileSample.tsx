'use client';

import { useT } from '@/lib/i18n';
import { Icon, type IconName } from './Icon';
import { SampleLabel } from './SampleLabel';

// A picture of the organization profile as the Organization Knowledge Hub
// presents it for review: one statement proposed with its source, one where
// two documents disagree, and one the documents do not cover. It shows the
// three promises the section makes — cited, flagged, approved by a person —
// with made-up content, and is labelled as an illustration. Nothing in it is a
// control: the three actions are drawn, not buttons.
export function ProfileSample() {
  const t = useT();
  return (
    <figure className="rounded-3xl border border-line bg-white p-5 shadow-sm sm:p-6">
      <figcaption>
        <SampleLabel />
      </figcaption>
      <div className="mt-4 space-y-4">
        <Statement field={t('hub.sample.mission.field')} state={t('hub.sample.mission.state')} icon="info" tone="info">
          <p className="text-sm leading-relaxed text-ink-primary">{t('hub.sample.mission.text')}</p>
          <Source>{t('hub.sample.mission.source')}</Source>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-md bg-primary px-3 py-1.5 text-ink-primary">{t('hub.sample.approve')}</span>
            <span className="rounded-md border border-line-strong px-3 py-1.5 text-ink-primary">
              {t('hub.sample.edit')}
            </span>
            <span className="rounded-md border border-line-strong px-3 py-1.5 text-ink-primary">
              {t('hub.sample.reject')}
            </span>
          </div>
        </Statement>

        <Statement
          field={t('hub.sample.served.field')}
          state={t('hub.sample.served.state')}
          icon="question"
          tone="caution"
        >
          <p className="text-sm leading-relaxed text-ink-secondary">{t('hub.sample.served.note')}</p>
          <ul className="mt-2 space-y-2">
            {(['a', 'b'] as const).map((side) => (
              <li key={side} className="rounded-lg bg-surface-muted px-3 py-2">
                <p className="text-sm text-ink-primary">{t(`hub.sample.served.${side}`)}</p>
                <Source>{t(`hub.sample.served.${side}.source`)}</Source>
              </li>
            ))}
          </ul>
        </Statement>

        <Statement field={t('hub.sample.goals.field')} state={t('hub.sample.goals.state')} icon="dash" tone="neutral">
          <p className="text-sm leading-relaxed text-ink-secondary">{t('hub.sample.goals.note')}</p>
        </Statement>
      </div>
    </figure>
  );
}

const TONES = {
  info: 'border-sky-300 bg-sky-50 text-sky-800',
  caution: 'border-amber-300 bg-amber-50 text-amber-800',
  neutral: 'border-slate-300 bg-slate-100 text-slate-700',
} as const;

function Statement({
  field,
  state,
  icon,
  tone,
  children,
}: {
  field: string;
  state: string;
  icon: IconName;
  tone: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{field}</p>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}
        >
          <Icon name={icon} className="h-3.5 w-3.5" />
          {state}
        </span>
      </div>
      {children}
    </div>
  );
}

function Source({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-secondary">
      <Icon name="document" className="h-3.5 w-3.5" />
      {children}
    </p>
  );
}
