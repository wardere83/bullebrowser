import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import { product } from '@bullebrowser/brand-tokens';
import { DownloadStart } from '@/components/DownloadStart';
import { pageMetadata } from '@/lib/metadata';
import { DOWNLOAD_FILES, type DownloadFile } from '@/lib/releases';

// One page per file the site hands out, at /get/<file>/. The download buttons
// link here, so every link stays on the site's own address; the page then
// starts the newest file of that kind. Where each file is stored is read at
// build time from a list that is never published.

export const dynamicParams = false;

export function generateStaticParams() {
  return DOWNLOAD_FILES.map((file) => ({ file }));
}

function sourceFor(file: DownloadFile): string | null {
  try {
    const list = JSON.parse(
      readFileSync(path.join(process.cwd(), '.release-downloads.json'), 'utf8'),
    ) as Partial<Record<DownloadFile, string>>;
    const url = list[file];
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ file: DownloadFile }>;
}): Promise<Metadata> {
  const { file } = await params;
  return {
    ...pageMetadata({
      title: 'Your download is starting',
      description: `Your ${product.name} download starts on this page: the strategic funding platform for businesses and CBOs.`,
      path: `/get/${file}/`,
    }),
    robots: { index: false, follow: false },
  };
}

export default async function GetPage({ params }: { params: Promise<{ file: DownloadFile }> }) {
  const { file } = await params;
  const url = sourceFor(file);
  return (
    <>
      {/* Starts the download once the page has painted, with or without scripts. */}
      {url && <meta httpEquiv="refresh" content={`1;url=${url}`} />}
      <DownloadStart url={url} />
    </>
  );
}
