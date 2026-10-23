import { Reveal } from './Reveal';

// The dark band that opens every page except the home page: the page's one h1,
// a sentence under it, and room for a call to action.
export function PageHero({
  title,
  sub,
  children,
}: {
  title: React.ReactNode;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden bg-surface-dark text-ink-inverse">
      <div
        aria-hidden="true"
        className="animate-blob pointer-events-none absolute -end-24 -top-16 h-80 w-80 rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative mx-auto max-w-5xl px-6 py-20 text-center md:py-24">
        <Reveal>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tighter sm:text-5xl">{title}</h1>
        </Reveal>
        <Reveal delay={100}>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-inverse/80">{sub}</p>
        </Reveal>
        {children && (
          <Reveal delay={180}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{children}</div>
          </Reveal>
        )}
      </div>
    </section>
  );
}
