// The site's icons, drawn inline so nothing is fetched and each one takes the
// colour of the text beside it. An icon here never carries meaning on its own:
// it always sits next to words, so it is hidden from screen readers.

const PATHS = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="M4 12.5 9 17.5 20 6.5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 3 3 5-6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01" />
    </>
  ),
  half: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </>
  ),
  dash: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  external: <path d="M14 5h5v5M19 5l-8 8M11 7H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  pause: <path d="M9 6v12M15 6v12" />,
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  replay: <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </>
  ),
  document: (
    <>
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

/** `flip` mirrors a directional icon, such as an arrow, in right-to-left text. */
export function Icon({
  name,
  className = 'h-4 w-4',
  flip = false,
}: {
  name: IconName;
  className?: string;
  flip?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${flip ? 'rtl:-scale-x-100' : ''} ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
