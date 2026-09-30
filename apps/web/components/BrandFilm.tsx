'use client';

import { useEffect, useRef, useState } from 'react';
import { asset } from '@/lib/asset';
import { useT } from '@/lib/i18n';

// The BulleBrowser film: a muted, looping product film in a rounded "cinema"
// frame. It autoplays like a hero video, except for visitors who ask for
// reduced motion — they get the poster and a play button instead. The film is
// rendered from packages/brand-tokens/film (see render.mjs there).
export function BrandFilm() {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (reduced) v.pause();
    else void v.play().catch(() => setPlaying(false));
  }, [reduced]);

  const toggle = async () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      try {
        await v.play();
      } catch {
        setPlaying(false);
      }
    } else v.pause();
  };

  return (
    <section id="film" aria-labelledby="film-title" className="scroll-mt-24">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h2 id="film-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
          {t('film.title')}
        </h2>
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">
          {t('film.label')}
        </span>
      </div>
      <div className="relative isolate overflow-hidden rounded-2xl bg-[#071422] shadow-[0_35px_85px_-40px_rgba(0,0,0,0.6)] ring-1 ring-white/10 md:rounded-3xl">
        <video
          ref={video}
          className="block aspect-video w-full"
          playsInline
          muted
          loop
          autoPlay={!reduced}
          preload="metadata"
          poster={asset('/media/bullebrowser-film-poster.jpg')}
          aria-label={t('film.play')}
          aria-describedby="film-description"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
        >
          <source src={asset('/media/bullebrowser-film.mp4')} type="video/mp4" />
        </video>
        {failed ? (
          <div className="absolute inset-0 grid place-items-center bg-black/40 text-sm text-white">
            {t('film.fallback')}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void toggle()}
            aria-label={playing ? t('film.pause') : t('film.play')}
            className="absolute bottom-4 right-4 grid h-11 w-11 place-items-center rounded-full bg-white text-ink-primary shadow-lg transition-transform duration-200 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary md:bottom-8 md:right-8 md:h-16 md:w-16"
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 md:h-6 md:w-6" fill="currentColor" aria-hidden>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 md:h-6 md:w-6" fill="currentColor" aria-hidden>
                <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" />
              </svg>
            )}
          </button>
        )}
      </div>
      <p id="film-description" className="sr-only">
        {t('film.description')}
      </p>
    </section>
  );
}
