import { product } from '@bullebrowser/brand-tokens';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: 'Privacy',
  description:
    'How BulleBrowser stores local data, contacts websites and search services, and sends requests to the AI provider you choose.',
  path: '/privacy/',
});

export default function PrivacyPage() {
  return (
    <div className="bg-surface-light">
      <div className="prose-lite mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight">Privacy</h1>
        <p className="mt-4 text-sm text-ink-secondary">Updated October 15, 2026</p>
        <p>
          BulleBrowser is a desktop browser by {product.vendor}. Your browsing and assistant
          requests are made from your device. We do not operate a proxy that receives your browsing
          traffic or AI conversations.
        </p>
        <h2>Data on your device</h2>
        <p>
          The app stores settings, browsing history, bookmarks, conversations, attached files and
          local funding-work records in its application data folder. Keys are encrypted and stored
          on this device. Documents, conversations and other local records do not receive additional
          encryption from the app; protect them with your device sign-in and disk encryption.
        </p>
        <ul>
          <li>
            macOS: <code>~/Library/Application Support/{product.name}</code>
          </li>
          <li>
            Windows: <code>%APPDATA%\{product.name}</code>
          </li>
          <li>
            Linux: <code>~/.config/{product.name}</code>
          </li>
        </ul>
        <p>
          Older installations may also hold organization profiles, documents, saved opportunities
          and analyses. Removing a screen from the app does not delete previously stored records.
          Files attached to chats are retained locally for eight days before cleanup. Backup or sync
          tools may copy data from this folder.
        </p>
        <h2>Websites and search services</h2>
        <p>
          Opening a page, whether you or the assistant opens it, sends a request to that website.
          The site can see your IP address and may set cookies or require sign-in. Search terms may
          be sent to your selected search engine, public search services used for source discovery,
          or official funding sources. Do not include confidential material in public search
          requests.
        </p>
        <p>
          The assistant can read page content to help with your task. Its visible activity does not
          make websites private or change their own terms. Common cookie banners can be handled
          according to your settings. You can stop an active task.
        </p>
        <h2>Your connected AI provider</h2>
        <p>
          Basic browsing and source discovery work without a provider key. Connecting your own
          provider enables model-powered assistance. Requests go directly from your device to that
          provider under your key and its terms and privacy policy.
        </p>
        <p>
          Depending on the task, a request can contain your prompt, conversation history, relevant
          page content, attached files and excerpts from local documents or records. The provider
          may retain or process that information according to your account settings.{' '}
          {product.vendor} does not receive those requests.
        </p>
        <h2>Updates, downloads and voice</h2>
        <p>
          The app checks GitHub for published releases and downloads updates from GitHub. A ready
          update is installed when you choose Update; the app automatically restarts and restores
          your tabs and current conversation. Voice input may download a speech-recognition model
          from a public hosting service; transcription then runs on your device.
        </p>
        <h2>This website</h2>
        <p>
          This static website is hosted on GitHub Pages. GitHub may keep standard server logs,
          including IP address, user agent and requested path. The download page uses a release list
          prepared during publication, with the public GitHub Releases API as a fallback. Installers
          are downloaded from GitHub. Your language choice is kept in your browser’s local storage.
        </p>
        <p>
          There are no analytics scripts or telemetry in the app or on this site, and this site sets
          no cookies of its own. If you email us, we receive the message and contact information you
          send.
        </p>
        <h2>Removing data</h2>
        <p>
          You can remove a provider key and clear browsing history in Settings. To remove all app
          data, quit BulleBrowser and delete its application data folder listed above. This removes
          local settings and records, including records created by earlier versions. Uninstalling
          the app alone does not remove that folder. Copies held in backups or by websites and
          connected providers must be managed separately.
        </p>
        <h2>Changes and contact</h2>
        <p>
          This page describes the current browser-first app and the local records that may remain
          from earlier versions. Changes to data handling will be reflected here and in the release
          notes.
        </p>
        <p>
          Questions: <a href={`mailto:${product.contactEmail}`}>{product.contactEmail}</a>.
        </p>
      </div>
    </div>
  );
}
