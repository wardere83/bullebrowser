import { product } from '@bullebrowser/brand-tokens';
import { EnglishOnlyNote } from '@/components/EnglishOnlyNote';
import { pageMetadata } from '@/lib/metadata';
import { KNOWLEDGE_HUB, SCREENS } from '@/lib/terms';

export const metadata = pageMetadata({
  title: 'Privacy',
  description: `What ${product.name} stores on your device, what leaves it and where it goes, and how to delete your documents or an organization.`,
  path: '/privacy/',
});

const EFFECTIVE_DATE = '2026-10-06';

// The privacy policy. It describes what the desktop app and this site actually
// do, so it has to change whenever they do: a new place data is stored, a new
// place it is sent, or a new way to delete it belongs here in the same change.
//
// It is published in English only. The wrapper marks it as English and
// left-to-right, so it reads correctly when the rest of the site is not.
//
// The funding sources are named in a sentence of their own here; keep that
// sentence in step with LIVE_SOURCES in lib/terms.ts.
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <EnglishOnlyNote />
      <div lang="en" dir="ltr" className="prose-lite">
        <h1 className="text-4xl font-bold tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-ink-secondary">
          Effective date: <time dateTime={EFFECTIVE_DATE}>{EFFECTIVE_DATE}</time>.
        </p>

        <h2>Plain-language summary</h2>
        <ul>
          <li>
            Your organization’s documents, the text extracted from them, your profile and your analyses
            are stored on your device.
          </li>
          <li>
            When you connect your own AI provider and ask for analysis, relevant excerpts of your documents go
            directly from your device to that provider, under your own key.
          </li>
          <li>
            Funding searches send search terms and filters, never documents, directly to the official sources.
          </li>
          <li>
            Nothing is routed through {product.vendor}, and {product.vendor} receives none of it.
          </li>
          <li>There is no analytics and no telemetry, in the app or on this website.</li>
        </ul>

        <h2>What {product.vendor} collects</h2>
        <p>
          From the desktop app: nothing. There is no account with us to create. The profile and the
          organizations you set up exist only on your device.
        </p>
        <p>
          This website ({product.domain}) is a static site hosted on GitHub Pages. GitHub may keep standard
          server logs (IP address, browser user agent, requested path) as part of serving it. The download
          page reads a list of installers that is prepared when the site is published; if that list cannot be
          read, your browser asks the public GitHub Releases API for it instead. Installers are downloaded
          from GitHub. The site remembers your language choice in your browser’s local storage, sets no
          cookies of its own and runs no analytics scripts.
        </p>

        <h2>What is stored on your device</h2>
        <p>{product.name} keeps its data in one folder for your user account:</p>
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
          Each organization you create has its own folder inside it, and nothing is looked up across
          organizations. For each organization, {product.name} stores:
        </p>
        <ul>
          <li>
            <strong>Organization details.</strong> Its name, whether it is a business or a CBO, and its
            location.
          </li>
          <li>
            <strong>{KNOWLEDGE_HUB} documents.</strong> {product.name}’s own copy of each file you add,
            and the text it extracted from that file. Your original file is left as it is.
          </li>
          <li>
            <strong>The organization profile.</strong> The statements that were proposed, approved or
            rejected, the passages they cite, and your &ldquo;Our Priorities&rdquo;.
          </li>
          <li>
            <strong>Funding documents.</strong> Each RFP you upload, its extracted text, and the analyses and
            alignment assessments made from it. A funding document is kept apart from the {KNOWLEDGE_HUB} and
            never changes the profile.
          </li>
          <li>
            <strong>Proposal guides.</strong> Outlines, questions and the observations made on your drafts. A
            draft you submit for feedback is not saved, but each observation quotes the words it refers to.
          </li>
          <li>
            <strong>Saved opportunities</strong> and the notes you add to them. Search results themselves are
            held in memory for a few minutes and are not written to disk.
          </li>
          <li>
            <strong>An activity record.</strong> What was done and when, such as a document added or a profile
            approved. It never contains document text.
          </li>
        </ul>
        <p>The same folder also holds:</p>
        <ul>
          <li>
            <strong>Your local profile.</strong> The display name and email address you enter. They are not
            sent to {product.vendor}.
          </li>
          <li>
            <strong>AI provider keys.</strong> Keys are encrypted and stored on this device.
          </li>
          <li>
            <strong>Assistant conversations and projects.</strong> Each belongs to the organization it was
            started in and is not shown under another.
          </li>
          <li>
            <strong>Files you attach to a chat.</strong> They are kept for eight days and then removed.
          </li>
          <li>
            <strong>Browsing history and bookmarks.</strong>
          </li>
          <li>
            <strong>Settings,</strong> and a speech-recognition model once you have used voice input.
          </li>
        </ul>
        <p>
          {product.name} does not add encryption of its own to documents, extracted text, profiles or
          analyses. They are protected by your device’s sign-in and, if you have turned it on, its disk
          encryption. A backup or sync tool that copies this folder copies them too.
        </p>

        <h2>What leaves your device, and where it goes</h2>

        <h3>Your AI provider, if you connect one</h3>
        <p>
          {product.name} works without one: the funding finder, document search and text matches in funding
          documents need no AI provider. Written analysis does. When you add your own provider key and ask for
          analysis, or send a message to the assistant, {product.name} sends the request directly from your
          device to that provider. Depending on what you asked, the request can include your message and the
          conversation so far, relevant excerpts of your organization’s documents and approved profile,
          text from a funding document you asked about, the content of web pages the assistant reads for you,
          and files you attach. The provider handles it under its own terms and privacy policy.{' '}
          {product.vendor} does not receive it.
        </p>
        <p>
          Before document excerpts are sent for the first time, {product.name} asks for your acknowledgement,
          once for each organization.
        </p>

        <h3>Official funding sources</h3>
        <p>
          When you search for funding, {product.name} sends your search terms and filters, such as geography,
          eligibility, funding category, award amount and deadline, directly from your device to the official
          sources it reads. Today those are Grants.gov, the California Grants Portal, the open-data services
          of New York City, Los Angeles and Montgomery County, Maryland, and the EU Funding &amp; Tenders
          Portal. Opening a listing, or re-checking one you saved, asks its source for that listing. Search
          terms can come from your approved priorities when you start a search from them. Your documents are
          never sent to these sources. Like any website, each source can see your IP address.
        </p>
        <p>
          Before the first search, {product.name} asks for your acknowledgement, once for each organization.
        </p>

        <h3>Websites you open</h3>
        <p>
          Opening a page, whether you do it or the assistant does it for you, works as it does in any browser:
          the site receives your request and may set cookies. {product.name} does not route that traffic
          through servers of its own. By default the assistant chooses the most private option on common
          cookie banners; you can turn that off in Settings. Words typed in the address bar go to the
          assistant or to the search engine you choose in Settings.
        </p>

        <h3>Updates and voice</h3>
        <p>
          The app asks GitHub about once an hour whether a new version exists, and downloads it from GitHub
          when one does. The first time you use voice input, a speech-recognition model is downloaded from a
          public model-hosting service and saved on your device; after that, speech is transcribed on your
          device.
        </p>

        <h2>Deleting your data</h2>
        <ul>
          <li>
            <strong>A document.</strong> In the {KNOWLEDGE_HUB}, find the document and delete it.{' '}
            {product.name} removes its copy of the file and the text extracted from it. Profile statements
            that cited the document are marked for review and are not used for guidance until you confirm
            them again. Your original file is not touched.
          </li>
          <li>
            <strong>A funding document.</strong> In {SCREENS.rfpAnalysis}, delete the funding document.{' '}
            {product.name} removes its copy of the file, the extracted text and the analyses made from it.
          </li>
          <li>
            <strong>A saved opportunity or a proposal guide.</strong> Remove it where it is listed.
          </li>
          <li>
            <strong>An organization, with everything it holds.</strong> Open the organization menu, choose
            &ldquo;Delete this organization&hellip;&rdquo; and type the organization’s name to confirm.
            Every document, profile, funding document, analysis and guide that the organization holds on this
            device is deleted, and this cannot be undone. Only an owner of the organization can do it.
          </li>
          <li>
            <strong>An AI provider key.</strong> Open Settings and choose &ldquo;Remove key&rdquo;.
          </li>
          <li>
            <strong>Browsing history.</strong> Open Settings and choose &ldquo;Clear browsing history&rdquo;.
            This does not affect your organizations, documents or funding work.
          </li>
          <li>
            <strong>Everything.</strong> Quit {product.name} and delete its data folder, named above.
            Uninstalling the app does not remove that folder.
          </li>
        </ul>

        <h2>Changes to this policy</h2>
        <p>
          This version covers the {KNOWLEDGE_HUB}, RFP analysis and the funding finder. They added two ways
          for data to leave your device, which are document excerpts sent to your AI provider and search terms
          sent to official funding sources, and each asks for your acknowledgement first.
        </p>
        <p>
          If a later version of {product.name} sends data anywhere new, it will ask first, and this page and
          the release notes will say so.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy: <a href={`mailto:${product.contactEmail}`}>{product.contactEmail}</a>.
        </p>
      </div>
    </div>
  );
}
