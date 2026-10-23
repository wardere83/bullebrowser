// The workspace's icons: inline SVG on a 24 by 24 grid, drawn with the current
// text colour, as everywhere else in the app. An icon is always decorative
// here. It is hidden from assistive technology, so whatever it stands for must
// also be said in words next to it (or in the control's label).

import type { ReactNode } from 'react';
import { cx } from './styles.js';

const PATHS = {
  home: (
    <>
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6.5 10v9.5h11V10" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  library: (
    <>
      <path d="M12 6.5C10.2 5.2 7.8 4.7 5 5v12.5c2.8-.3 5.2.2 7 1.5 1.8-1.3 4.2-1.8 7-1.5V5c-2.8-.3-5.2.2-7 1.5Z" />
      <path d="M12 6.5V19" />
    </>
  ),
  document: (
    <>
      <path d="M6.5 3.5h8l3 3v14h-11z" />
      <path d="M14.5 3.5v3h3M9.5 11.5h5M9.5 15h5" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4.5V20M8 20h8M5.5 8h13" />
      <path d="M5.5 8 3 14a2.6 2.6 0 0 0 5 0L5.5 8ZM18.5 8 16 14a2.6 2.6 0 0 0 5 0l-2.5-6Z" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.2 8.8-1.8 4.6-4.6 1.8 1.8-4.6 4.6-1.8Z" />
    </>
  ),
  pencil: (
    <>
      <path d="m4.5 19.5 1-4L16.6 4.4a2 2 0 0 1 2.9 2.9L8.5 18.5l-4 1Z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.2 12.3 2.6 2.6 5-5.2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.7 9.6a2.4 2.4 0 1 1 3.5 2.1c-.8.4-1.2 1-1.2 1.8M12 16.6h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 20.5 19h-17L12 4.5Z" />
      <path d="M12 10v4M12 16.6h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  x: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  'x-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="8.5" />,
  'circle-dashed': <circle cx="12" cy="12" r="8.5" strokeDasharray="3 3.3" />,
  progress: <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />,
  'chevron-down': <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  'chevron-right': <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  upload: <path d="M12 15.5V5M7.5 9.5 12 5l4.5 4.5M5 19.5h14" />,
  external: (
    <>
      <path d="M13.5 5H19v5.5M19 5l-8 8" />
      <path d="M10 6.5H6.5A1.5 1.5 0 0 0 5 8v9.5A1.5 1.5 0 0 0 6.5 19H16a1.5 1.5 0 0 0 1.5-1.5V14" />
    </>
  ),
  building: (
    <>
      <path d="M5.5 20V5.5A1.5 1.5 0 0 1 7 4h7a1.5 1.5 0 0 1 1.5 1.5V20M15.5 10H18a1.5 1.5 0 0 1 1.5 1.5V20M3.5 20h17" />
      <path d="M8.5 8h1M11.5 8h1M8.5 11.5h1M11.5 11.5h1M8.5 15h1M11.5 15h1" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14M9.5 7V5h5v2M7 7l.8 12.5h8.4L17 7" />
      <path d="M10.5 10.5v5.5M13.5 10.5v5.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M5 8h8M19 8h-1M5 16h1M11 16h8" />
      <circle cx="15.5" cy="8" r="2.5" />
      <circle cx="8.5" cy="16" r="2.5" />
    </>
  ),
  bookmark: <path d="M7 4.5h10v15l-5-3.6-5 3.6z" />,
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 5v4h-4" />
    </>
  ),
  list: <path d="M9 7h10M9 12h10M9 17h10M5 7h.01M5 12h.01M5 17h.01" />,
  chat: <path d="M5 5.5h14V16h-8l-4 3.5V16H5z" />,
  pin: (
    <>
      <path d="M12 20.5s6-5.3 6-10.2a6 6 0 1 0-12 0c0 4.9 6 10.2 6 10.2Z" />
      <circle cx="12" cy="10.2" r="2.2" />
    </>
  ),
  calendar: <path d="M5 6.5h14v13H5zM5 10.5h14M8.5 4v4M15.5 4v4" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/** Every icon name, for places that need to check one. */
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/**
 * One of the workspace's icons. Pass `size` in pixels (16 by default) and set
 * the colour with a text colour class.
 */
export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx('shrink-0', className)}
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * The mark for work in progress. It turns only when the user has not asked for
 * reduced motion, so the words beside it must say what is happening.
 */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Icon name="progress" size={size} className={cx('motion-safe:animate-spin', className)} />;
}
