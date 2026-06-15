import type { Metadata } from 'next';
import { product } from '@bullebrowser/brand-tokens';
import { DownloadTable } from '@/components/DownloadTable';

export const metadata: Metadata = {
  title: 'Download',
  description: `Download ${product.name} for macOS, Windows, or Linux.`,
};

export default function DownloadPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-3xl font-bold">Download {product.name}</h1>
      <DownloadTable />
      <p className="mt-6 text-xs text-ink-secondary">
        Releases are currently unsigned — see the{' '}
        <a href="/install" className="underline">install guide</a> for
        first-launch steps on macOS and Windows.
      </p>
    </div>
  );
}
