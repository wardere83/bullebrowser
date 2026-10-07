import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: 'About the app',
  description:
    'Discover BulleBrowser, the desktop app that brings web research and organization evidence together to support funding strategy for businesses and CBOs.',
  path: '/features/',
});

export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
