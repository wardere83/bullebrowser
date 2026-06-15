import type { Metadata } from 'next';
import Link from 'next/link';
import { product } from '@bullebrowser/brand-tokens';
import { DownloadButton } from '@/components/DownloadButton';

export const metadata: Metadata = {
  title: 'Install & setup',
  description: `How to install ${product.name} and turn on the AI agent.`,
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-white">
        {n}
      </div>
      <div className="pb-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <div className="mt-1 text-sm text-ink-secondary [&_code]:rounded [&_code]:bg-surface-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px]">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function InstallPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold">Install {product.name}</h1>
      <p className="mt-2 text-ink-secondary">
        From download to a working AI agent in a few minutes. No technical
        background needed.
      </p>
      <div className="mt-6">
        <DownloadButton size="md" />
      </div>

      <div className="mt-12 space-y-8">
        <Step n={1} title="Open the installer">
          <p>
            <strong>macOS:</strong> open the <code>.dmg</code>, drag
            BulleBrowser into Applications, then{' '}
            <strong>right-click → Open → Open</strong> the first time (this
            clears the unsigned-app prompt). If you see “is damaged,” run{' '}
            <code>xattr -dr com.apple.quarantine /Applications/BulleBrowser.app</code>.
          </p>
          <p className="mt-2">
            <strong>Windows:</strong> run the <code>.exe</code>; if SmartScreen
            appears, click <strong>More info → Run anyway</strong>.
          </p>
          <p className="mt-2">
            <strong>Linux:</strong> <code>chmod +x BulleBrowser-*.AppImage</code>{' '}
            then run it.
          </p>
        </Step>

        <Step n={2} title="Add your AI API key">
          <p>
            BulleBrowser is bring-your-own-key — your prompts go directly to
            the AI provider, never to {product.vendor}. Get a key at{‘ ‘}
            <a className="text-primary underline" href="https://console.anthropic.com">
              console.anthropic.com
            </a>{‘ ‘}
            (starts with <code>sk-ant-</code>), then in BulleBrowser open the
            profile menu → <strong>Settings</strong> → paste it → Save. It’s
            stored encrypted in your OS keychain.
          </p>
        </Step>

        <Step n={3} title="Open the AI panel and pick a skill">
          <p>
            Press <code>Ctrl/Cmd + Shift + A</code> (or click <strong>AI</strong>),
            choose a preset Skill — Grant scanner, RFP comparator, or
            Compliance review — and describe your task. The agent drives the
            tabs and hands back a results table.
          </p>
        </Step>
      </div>

      <div className="mt-12 rounded-lg border border-line bg-surface-muted p-5 text-sm">
        <div className="font-semibold">Why the safety prompt?</div>
        <p className="mt-1 text-ink-secondary">
          The installers are currently unsigned (no paid developer
          certificate yet), so macOS and Windows show a one-time warning. The
          steps above are the standard way to launch unsigned apps. Every
          release also ships a <code className="rounded bg-white px-1">checksums.txt</code>{' '}
          so you can verify your download.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/download" className="text-primary underline">
          All platforms &amp; checksums
        </Link>
        <Link href="/preview" className="text-primary underline">
          See the app screens
        </Link>
        <Link href="/features" className="text-primary underline">
          What the agent can do
        </Link>
      </div>
    </div>
  );
}
