// What each page tells search engines and link previews about itself.
//
// Pages that read the visitor's language are client components, and a client
// component cannot export metadata. Each of those routes therefore has a small
// server layout beside its page that exports what this builds. The site is
// exported as English, so these lines are English.

import type { Metadata } from 'next';
import { product } from '@bullebrowser/brand-tokens';

export const SITE_URL = `https://${product.domain}`;

// Served with a .png extension on purpose: the host picks the content type
// from the extension, and link previews ignore an image sent as plain bytes.
export const SHARE_IMAGE = {
  url: '/og.png',
  width: 1200,
  height: 630,
  alt: `${product.name} — ${product.tagline}`,
} as const;

/** `path` is the page's address on the site, with its trailing slash. */
export function pageMetadata(page: { title: string; description: string; path: string }): Metadata {
  const url = `${SITE_URL}${page.path}`;
  const shareTitle = `${page.title} · ${product.name}`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      title: shareTitle,
      description: page.description,
      url,
      siteName: product.name,
      type: 'website',
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description: page.description,
      images: [SHARE_IMAGE],
    },
  };
}
