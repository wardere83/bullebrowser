import { useEffect, useId, useRef, useState } from 'react';
import { product } from '@bullebrowser/brand-tokens';
import wordmarkLight from '@bullebrowser/brand-tokens/wordmark-light.png';
import filmUrl from '../assets/bullebrowser-film.mp4';
import posterUrl from '../assets/bullebrowser-film-poster.jpg';

/** The previous video intro, with the current funding strategy and film. */
export function Splash() {
  const video = useRef<HTMLVideoElement>(null);
  const descriptionId = useId();
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
    if (reducedMotion) video.current?.pause();
    else void video.current?.play().catch(() => setPlaying(false));
  }, [reducedMotion]);

  const togglePlayback = () => {
    const film = video.current;
    if (!film) return;
    if (film.paused) void film.play().catch(() => setPlaying(false));
    else film.pause();
  };

  return (
    <section
      aria-label="BulleBrowser funding introduction"
      className="h-full overflow-y-auto bg-surface-dark px-6 py-8 text-ink-inverse"
    >
      <div className="flex min-h-full flex-col items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1>
            <img
              src={wordmarkLight}
              alt={product.name}
              className="h-16 w-auto max-w-full select-none"
              draggable={false}
            />
          </h1>
          <p className="text-sm text-ink-inverse/70">{product.tagline}</p>
        </div>

        <div className="w-full max-w-3xl">
          <div className="relative overflow-hidden rounded-2xl bg-black shadow-[0_30px_70px_-35px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
            {failed ? (
              <img
                src={posterUrl}
                alt="An illustrative funding workflow"
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
                  autoPlay={!reducedMotion}
                  controls={false}
                  disablePictureInPicture
                  preload="auto"
                  aria-label="BulleBrowser funding strategy video"
                  aria-describedby={descriptionId}
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
          <p id={descriptionId} className="mt-3 text-center text-xs leading-relaxed text-ink-inverse/60">
            Discover relevant funding, understand funder priorities, assess your alignment and develop proposals ethically.
            <span className="block">Illustrative walkthrough · fictional organization and funding data.</span>
          </p>
          {failed && (
            <p role="status" className="mt-2 text-center text-xs text-ink-inverse/70">
              The video couldn’t load. The funding tools in the chat are still available.
            </p>
          )}
        </div>

        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-inverse/40">
          by {product.vendor}
        </div>
      </div>
    </section>
  );
}
