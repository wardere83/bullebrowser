import { product } from '@bullebrowser/brand-tokens';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: 'About',
  description: `Why ${product.vendor} built ${product.name}, a strategic funding platform for businesses and CBOs, and what it will not do.`,
  path: '/about/',
});

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
