import { product } from '@bullebrowser/brand-tokens';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: 'Install and set up',
  description: `Install ${product.name}, create your organization, add documents to the Organization Knowledge Hub and run your first funding search.`,
  path: '/install/',
});

export default function InstallLayout({ children }: { children: React.ReactNode }) {
  return children;
}
