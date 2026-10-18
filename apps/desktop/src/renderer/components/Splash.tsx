import { useAccessibilityStore } from '../state/accessibility-store.js';
import { useEffect, useRef, useState } from 'react';
import { product } from '@bullebrowser/brand-tokens';
import wordmark from '@bullebrowser/brand-tokens/wordmark.png';
import filmUrl from '../assets/bullebrowser-film.mp4';
import posterUrl from '../assets/bullebrowser-film-poster.jpg';

/** The shared browser-first product walkthrough. */
export function Splash() {
  const video = useRef<HTMLVideoElement>(null);
  const preferencesReady = useAccessibilityStore((s) => s.ready);
  const motion = useAccessibilityStore((s) => s.preferences.motion);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    if (!preferencesReady || reducedMotion || motion === 'reduce') video.current?.pause();
    else void video.current?.play().catch(() => setPlaying(false));
  }, [reducedMotion, motion, preferencesReady]);

  const togglePlayback = () => {
    const film = video.current;
    if (!film) return;
    if (film.paused) void film.play().catch(() => setPlaying(false));
    else film.pause();
  };

  return (
    <section
      aria-label="BulleBrowser funding introduction"
      className="h-full overflow-y-auto bg-white px-6 py-8 text-ink-primary"
    >
      <div className="flex min-h-full flex-col items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1>
            <img
              src={wordmark}
              alt={product.name}
              className="h-16 w-auto max-w-full select-none"
              draggable={false}
            />
          </h1>
          <p className="text-sm text-ink-primary/70">{product.tagline}</p>
        </div>

        <div className="w-full max-w-3xl">
          <div className="relative overflow-hidden rounded-2xl bg-black shadow-[0_25px_65px_-35px_rgba(7,20,34,0.35)] ring-1 ring-black/10">
            {failed ? (
              <img
                src={posterUrl}
                alt="BulleBrowser illustrated browsing walkthrough"
                className="block aspect-video w-full"
              />
            ) : (
              <>
                <video
                  ref={video}
                  className="block aspect-video w-full"
                  src={filmUrl}
                  poster={posterUrl}
                  muted
                  loop
                  playsInline
                  autoPlay={preferencesReady && !reducedMotion && motion !== 'reduce'}
                  controls={false}
                  disablePictureInPicture
                  preload="auto"
                  aria-label="BulleBrowser visible browsing video"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onError={() => setFailed(true)}
                />
                <button
                  type="button"
                  onClick={togglePlayback}
                  aria-label={playing ? 'Pause intro video' : 'Play intro video'}
                  className="absolute bottom-3 right-3 rounded-md bg-black/80 px-3 py-1.5 text-xs text-white hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {playing ? 'Pause' : 'Play'}
                </button>
              </>
            )}
          </div>
          {failed && (
            <p role="status" className="mt-2 text-center text-xs text-ink-primary/70">
              The video couldn’t load.
            </p>
          )}
        </div>

        <p className="text-xs text-ink-primary/60">© 2026 BulleBrowser.</p>
      </div>
    </section>
  );
}
