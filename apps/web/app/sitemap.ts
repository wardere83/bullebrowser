import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/metadata';

export const dynamic = 'force-static';

// Every page, at the address it is actually served from. The export uses
// trailing slashes, so the addresses here carry them too.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/features/`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/download/`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/install/`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/about/`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${SITE_URL}/privacy/`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
  ];
}
