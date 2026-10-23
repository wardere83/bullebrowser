import { product } from '@bullebrowser/brand-tokens';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: 'Install and start browsing',
  description: `Install ${product.name} on macOS, Windows or Linux, choose a browsing option and follow your first visible research task.`,
  path: '/install/',
});

export default function InstallLayout({ children }: { children: React.ReactNode }) {
  return children;
}
