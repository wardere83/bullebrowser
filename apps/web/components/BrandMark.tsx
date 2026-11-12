import { useId } from 'react';

/** BulleBrowser's app mark (public/logo.svg), drawn inline and hidden from screen readers. */
export function BrandMark({ className = 'h-5 w-5' }: { className?: string }) {
  const gradient = useId();
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#20BAD1" />
          <stop offset="100%" stopColor="#1A9BAE" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill={`url(#${gradient})`} />
      <path
        d="M21 17h13.5c5.4 0 9 2.7 9 7.4 0 3-1.6 5.1-4.5 6.2 3.7 1 5.8 3.4 5.8 7 0 5-3.8 7.9-9.7 7.9H21V17zm6.6 5v8.1h6.3c2.7 0 4.3-1.5 4.3-4 0-2.6-1.6-4.1-4.3-4.1h-6.3zm0 12.8v8.6h7.1c2.9 0 4.6-1.6 4.6-4.3 0-2.8-1.7-4.3-4.6-4.3h-7.1z"
        fill="#FFFFFF"
      />
      <circle cx="49" cy="48" r="5" fill="#E8D833" />
    </svg>
  );
}
