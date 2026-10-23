import Link from 'next/link';
import { Icon } from './Icon';
import { link } from './styles';

// A text link that leads on to another page or section. The arrow points the
// way the text reads, so it turns round in a right-to-left language.
export function ArrowLink({
  href,
  children,
  tone = 'light',
  className = '',
}: {
  href: string;
  children: React.ReactNode;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 text-sm ${tone === 'dark' ? link.onDark : link.onLight} ${className}`}
    >
      {children}
      <Icon name="arrow" flip />
    </Link>
  );
}
