import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: 'Workflows',
  description:
    'How BulleBrowser helps businesses and CBOs find funding in official sources, understand funder priorities, assess their alignment and develop proposals ethically.',
  path: '/features/',
});

export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
