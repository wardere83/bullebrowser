import Link from 'next/link';
import { product } from '@bullebrowser/brand-tokens';
import { DownloadButton } from '@/components/DownloadButton';
import { AgentDemo } from '@/components/AgentDemo';

const SKILLS = [
  {
    title: 'Grant scanner',
    lede: 'Scan funding without the tab-juggling.',
    body: 'Searches SAM.gov and Grants.gov, follows each listing into its detail page, and returns a table sorted by deadline — award ceilings and links included.',
  },
  {
    title: 'RFP comparator',
    lede: 'Go / no-go in minutes.',
    body: 'Paste 2–4 RFP links. It reads each end to end and lays deadline, scope, eligibility, contract value, and evaluation criteria side by side.',
  },
  {
    title: 'Compliance review',
    lede: 'Catch the gaps before review does.',
    body: 'Flags clauses against EEO, FERPA, and ADA — plus any checklist items you add — and quotes each one with its section reference.',
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero — text left, live agent demo on the right */}
      <section className="bg-surface-dark text-ink-inverse">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:grid-cols-[1.05fr_1fr] md:py-32">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs tracking-wide">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Agentic AI · By {product.vendor}
            </div>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
              The browser that does the work.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-inverse/70">
              An AI agent that researches grants, compares RFPs, and reviews
              compliance — and works whatever else you ask, right inside your
              browser.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-5">
              <DownloadButton />
              <Link href="/preview" className="text-sm text-ink-inverse/70 underline-offset-4 hover:underline">
                See it in action →
              </Link>
            </div>
          </div>
          <AgentDemo />
        </div>
      </section>

      {/* Three agentic skills — the heart of BulleBrowser */}
      <section className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="text-xs font-semibold uppercase tracking-widest text-primary">
          Agentic skills
        </div>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Native intelligence, built into the browser.
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-secondary">
          Not a chatbot bolted onto a sidebar. {product.name} is purpose-built
          for the grant, RFP, and compliance work {product.vendor} does every
          day. Three flagship skills lead the way — and the agent takes on much
          more on request.
        </p>
        <div className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-3">
          {SKILLS.map((s) => (
            <div key={s.title}>
              <h3 className="text-lg font-semibold">{s.title}</h3>
              <p className="mt-1 text-[15px] font-medium text-ink-primary">{s.lede}</p>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">{s.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 max-w-2xl text-[15px] leading-relaxed text-ink-secondary">
          These three lead the way — among many other tasks the agent will take
          on. Pick a preset for a guided run, or just describe what you need in
          plain language and it works the live tab for you.
        </p>
        <div className="mt-12">
          <Link href="/features" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Explore the features →
          </Link>
        </div>
      </section>

      {/* Privacy — one statement */}
      <section className="border-t border-line bg-surface-muted">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center md:py-32">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Your data stays yours.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ink-secondary">
            Bring your own key. Prompts go straight to the AI provider on
            your own account — never to {product.vendor}. History and
            conversations stay on your device. No telemetry.
          </p>
          <div className="mt-10 flex justify-center">
            <DownloadButton />
          </div>
        </div>
      </section>
    </>
  );
}
