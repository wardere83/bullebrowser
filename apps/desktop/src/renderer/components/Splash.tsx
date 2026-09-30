import { useEffect, useRef, useState } from 'react';
import { product } from '@bullebrowser/brand-tokens';
import wordmarkLight from '@bullebrowser/brand-tokens/wordmark-light.png';
import filmUrl from '../assets/bullebrowser-film.mp4';
import posterUrl from '../assets/bullebrowser-film-poster.jpg';

// The start page: the wordmark, then the BulleBrowser film in a cinema frame
// (the same film as bullebrowser.com, rendered from packages/brand-tokens/film).
// It plays muted on a loop, except when the OS asks for reduced motion, where
// it waits on its poster for the play button.
export function Splash() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (!reduced) void video.current?.play().catch(() => setPlaying(false));
  }, [reduced]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 overflow-y-auto bg-surface-dark px-10 py-10 text-ink-inverse">
      <div className="flex flex-col items-center gap-3">
        {/* The shine is a gradient sweep masked to the logo's own alpha, so it
            travels across the mark itself rather than a rectangle around it —
            hence the wrapper: the <img> paints the logo, the ::after paints the
            light passing over it. */}
        <div className="splash-logo splash-logo--steady">
          <img
            src={wordmarkLight}
            alt={product.name}
            className="splash-logo__img h-16 w-auto select-none"
            draggable={false}
          />
        </div>
        <div className="text-sm text-ink-inverse/70">{product.tagline}</div>
      </div>

      {!failed && (
        <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-black shadow-[0_30px_70px_-35px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
          <video
            ref={video}
            className="block aspect-video w-full"
            src={filmUrl}
            poster={posterUrl}
            muted
            loop
            playsInline
            autoPlay={!reduced}
            preload="auto"
            aria-label={`The ${product.name} film`}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setFailed(true)}
          />
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Pause the film' : `Play the ${product.name} film`}
            className="absolute bottom-4 right-4 grid h-11 w-11 place-items-center rounded-full bg-white text-surface-dark shadow-lg transition-transform duration-200 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" />
              </svg>
            )}
          </button>
        </div>
      )}

      <div className="text-[11px] uppercase tracking-[0.18em] text-ink-inverse/40">
        by {product.vendor}
      </div>
    </div>
  );
}
