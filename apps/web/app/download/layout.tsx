import { product } from '@bullebrowser/brand-tokens';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: 'Download',
  description: `Download ${product.name} for macOS, Windows and Linux: the strategic funding platform for businesses and CBOs.`,
  path: '/download/',
});

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
