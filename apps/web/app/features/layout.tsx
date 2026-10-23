import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: 'About the app',
  description:
    'Discover BulleBrowser, the desktop browser that opens and reads source pages visibly, with four guided browsing options for businesses and CBOs.',
  path: '/features/',
});

export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
