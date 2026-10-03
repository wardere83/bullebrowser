import { useState } from 'react';
import { product } from '@bullebrowser/brand-tokens';
import wordmarkLight from '@bullebrowser/brand-tokens/wordmark-light.png';
import filmUrl from '../assets/bullebrowser-film.mp4';
import posterUrl from '../assets/bullebrowser-film-poster.jpg';

// The start page: the wordmark, then the BulleBrowser film in a cinema frame
// (the same film as bullebrowser.com, rendered from packages/brand-tokens/film).
// It autoplays muted on a loop without playback controls.
export function Splash() {
  const [failed, setFailed] = useState(false);

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
        <div
          className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-black shadow-[0_30px_70px_-35px_rgba(0,0,0,0.8)] ring-1 ring-white/10"
          onContextMenu={(event) => event.preventDefault()}
        >
          <video
            className="pointer-events-none block aspect-video w-full select-none"
            src={filmUrl}
            poster={posterUrl}
            muted
            loop
            playsInline
            autoPlay
            controls={false}
            disablePictureInPicture
            preload="auto"
            aria-label={`The ${product.name} film`}
            onError={() => setFailed(true)}
          />
        </div>
      )}

      <div className="text-[11px] uppercase tracking-[0.18em] text-ink-inverse/40">
        by {product.vendor}
      </div>
    </div>
  );
}
