// The site's sections and what each one is called in the navigation.
//
// The owner pinned these names to English in every language (commit 8147ed3):
// they are fixed section names, and only the page bodies translate. Each name
// has a translation in the dictionaries all the same, so reversing that
// decision is this one constant.

import { useEnglishLang, useT, type MessageKey } from '@/lib/i18n';

export const TRANSLATE_SECTION_NAMES: boolean = false;

export const SECTIONS = {
  home: { href: '/', name: 'Home', key: 'nav.home' },
  workflows: { href: '/features', name: 'Workflows', key: 'nav.workflows' },
  guides: { href: '/install', name: 'Guides', key: 'nav.guides' },
  download: { href: '/download', name: 'Download', key: 'nav.download' },
  about: { href: '/about', name: 'About', key: 'nav.about' },
  privacy: { href: '/privacy', name: 'Privacy', key: 'nav.privacy' },
} as const satisfies Record<string, { href: string; name: string; key: MessageKey }>;

export type SectionId = keyof typeof SECTIONS;

/**
 * `label` gives a section's name as the navigation should show it. `lang` is
 * the language to mark those names with: English names inside a page in
 * another language are announced as English.
 */
export function useSectionNames(): { label: (id: SectionId) => string; lang: 'en' | undefined } {
  const t = useT();
  const english = useEnglishLang();
  return {
    label: (id) => (TRANSLATE_SECTION_NAMES ? t(SECTIONS[id].key) : SECTIONS[id].name),
    lang: TRANSLATE_SECTION_NAMES ? undefined : english,
  };
}

/** Whether a path is inside a section. Paths arrive with a trailing slash. */
export function isCurrent(pathname: string, id: SectionId): boolean {
  const { href } = SECTIONS[id];
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
