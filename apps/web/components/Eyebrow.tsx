import { eyebrow, eyebrowRule } from './styles';

// The small uppercase line above a section heading, opened by a short teal
// rule. On a light surface the words are gray and the rule carries the brand
// colour, because teal words on white are too faint to read.
export function Eyebrow({ children, tone = 'light' }: { children: React.ReactNode; tone?: 'light' | 'dark' }) {
  return (
    <p className={tone === 'dark' ? eyebrow.onDark : eyebrow.onLight}>
      <span aria-hidden="true" className={eyebrowRule} />
      {children}
    </p>
  );
}
