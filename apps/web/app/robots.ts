import type { MetadataRoute } from 'next';
import { product } from '@bullebrowser/brand-tokens';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: '/get/' }],
    sitemap: `https://${product.domain}/sitemap.xml`,
  };
}
