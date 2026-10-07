'use client';

import { useEffect, useRef, useState } from 'react';
import { asset } from '@/lib/asset';
import { useT } from '@/lib/i18n';
import { Icon } from './Icon';
import { SampleLabel } from './SampleLabel';

// The BulleBrowser film: a muted, looping product film in a rounded "cinema"
// frame. It autoplays like a hero video, except for visitors who ask for
// reduced motion — they get the poster and a play button instead. The film is
// rendered from packages/brand-tokens/film (see render.mjs there).
//
// What the film shows is made up, and the frame says so: a bar across the top
// carries the illustration label for as long as the film is on screen, and the
// caption underneath says what is fictional.
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
      <h2 id="film-title" className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">
        {t('film.title')}
      </h2>
      <figure>
        <div className="relative isolate overflow-hidden rounded-2xl bg-[#071422] shadow-[0_35px_85px_-40px_rgba(0,0,0,0.6)] ring-1 ring-white/10 md:rounded-3xl">
          <div className="flex justify-center border-b border-white/10 px-3 py-2">
            <SampleLabel tone="dark" />
          </div>
          <div className="relative">
            <video
              ref={video}
              className="block aspect-video w-full"
              playsInline
              muted
              loop
              autoPlay={!reduced}
              preload="metadata"
              poster={asset('/media/bullebrowser-film-poster.jpg')}
              aria-labelledby="film-title"
              aria-describedby="film-description"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setFailed(true)}
            >
              {/* A failed <source> fires error on itself, not on the <video>. */}
              <source
                src={asset('/media/bullebrowser-film.mp4')}
                type="video/mp4"
                onError={() => setFailed(true)}
              />
            </video>
            {failed ? (
              <div className="absolute inset-0 grid place-items-center bg-black/60 px-4 text-center text-sm text-white">
                {t('film.fallback')}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void toggle()}
                className="absolute bottom-4 end-4 grid h-11 w-11 place-items-center rounded-full bg-white text-ink-primary shadow-lg transition-transform duration-200 hover:scale-110 md:bottom-8 md:end-8 md:h-16 md:w-16"
              >
                <Icon name={playing ? 'pause' : 'play'} className="h-5 w-5 md:h-7 md:w-7" />
                <span className="sr-only">{playing ? t('film.pause') : t('film.play')}</span>
              </button>
            )}
          </div>
        </div>
        <figcaption className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-inverse/80">
          {t('film.caption')}
        </figcaption>
      </figure>
      <p id="film-description" className="sr-only">
        {t('film.description')}
      </p>
    </section>
  );
}
