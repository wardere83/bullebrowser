'use client';
import { useT } from '@/lib/i18n';
import { mobileDownload } from '@/lib/mobile-downloads';
import { button } from './styles';

export function MobileDownloads() {
  const t = useT();
  const options = [
    {
      id: 'ios' as const,
      name: 'iOS · iPhone & iPad',
      address: process.env.NEXT_PUBLIC_IOS_APP_URL,
      action: 'mobile.appStore' as const,
    },
    {
      id: 'android' as const,
      name: 'Android',
      address: process.env.NEXT_PUBLIC_ANDROID_APP_URL,
      action: 'mobile.playStore' as const,
    },
  ];
  return (
    <section
      id="mobile-downloads"
      aria-labelledby="mobile-title"
      className="mt-10 border-t border-line pt-8"
    >
      <h2 id="mobile-title" className="text-2xl font-semibold tracking-tight text-ink-primary">
        {t('mobile.heading')}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{t('mobile.description')}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {options.map((option) => {
          const download = mobileDownload(option.id, option.address);
          return (
            <article
              key={option.id}
              className="flex flex-col items-start gap-4 rounded-2xl border border-line p-5"
            >
              <h3 className="text-lg font-semibold text-ink-primary">{option.name}</h3>
              {download ? (
                <a
                  href={download.url}
                  className={button.small}
                  aria-label={`${t(download.beta ? 'mobile.beta' : option.action)} — ${option.name}`}
                >
                  {t(download.beta ? 'mobile.beta' : option.action)}
                </a>
              ) : (
                <p className="rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-ink-secondary">
                  {t('mobile.pending')}
                </p>
              )}
            </article>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-ink-secondary">{t('mobile.permissions')}</p>
    </section>
  );
}
