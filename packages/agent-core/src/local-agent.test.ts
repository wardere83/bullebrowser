import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FUNDING_SCREENS } from './terminology.js';
import type { AgentInput, AgentStep, ToolContext } from './types.js';

// No engine is connected in any of these runs. The SDK is mocked only so a
// test can prove that it was never reached.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
    constructor(_opts: unknown) {}
  },
}));

const { DEFAULT_MODEL, runAgent } = await import('./agent-loop.js');

const PAGE = {
  title: 'City Arts Fund',
  url: 'https://example.gov/arts-fund',
  text: 'The City Arts Fund supports neighbourhood festivals. Applications close on the first Friday of May.',
};

function makeContext(overrides?: Partial<ToolContext['runtime']>): ToolContext {
  return {
    activeTabId: 't1',
    signal: new AbortController().signal,
    runtime: {
      navigate: vi.fn(async (_id, url) => ({ url, title: 'Example' })),
      readPage: vi.fn(async () => PAGE),
      click: vi.fn(async (_id, target) => ({ matched: target })),
      type: vi.fn(async (_id, target) => ({ matched: target })),
      extract: vi.fn(async () => ({ data: { title: 'City Arts Fund', keyPoints: ['Festivals'] } })),
      screenshot: vi.fn(async () => ({ pngBase64: 'iVBORw0KGgo=' })),
      newTab: vi.fn(async (url) => ({ id: 't2', title: 'New', url: url ?? 'about:blank', active: true })),
      switchTab: vi.fn(async (id) => ({ id, title: 'X', url: 'https://x', active: true })),
      listTabs: vi.fn(async () => [
        { id: 't1', title: 'City Arts Fund', url: PAGE.url, active: true },
        { id: 't2', title: 'Grants.gov', url: 'https://www.grants.gov/', active: false },
      ]),
      closeTab: vi.fn(async () => ({ closed: true })),
      goBack: vi.fn(async () => ({ url: 'https://prev' })),
      goForward: vi.fn(async () => ({ url: 'https://next' })),
      reload: vi.fn(async () => ({ url: 'https://r' })),
      scroll: vi.fn(async () => ({ scrolledTo: 600 })),
      pressKey: vi.fn(async (_id, key) => ({ pressed: key })),
      waitFor: vi.fn(async () => ({ matched: true })),
      confirmDestructive: vi.fn(async () => true),
      listLinks: vi.fn(async () => [
        { text: 'Guidelines', href: 'https://example.gov/arts-fund/guidelines' },
        { text: 'Apply', href: 'https://example.gov/arts-fund/apply' },
      ]),
      ...overrides,
    },
  };
}

interface Asked {
  reply: string;
  steps: AgentStep[];
  context: ToolContext;
  requestBrowseAccess: ReturnType<typeof vi.fn>;
}

async function ask(userMessage: string, overrides: Partial<AgentInput> = {}): Promise<Asked> {
  const context = overrides.context ?? makeContext();
  const steps: AgentStep[] = [];
  const requestBrowseAccess = vi.fn(async () => true);
  const reply = await runAgent({
    model: DEFAULT_MODEL,
    systemPrompt: '',
    history: [],
    userMessage,
    requestBrowseAccess,
    onStep: (step) => steps.push(step),
    ...overrides,
    context,
  });
  return { reply, steps, context, requestBrowseAccess };
}

describe('the keyless assistant', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    createMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    // Whatever was asked, nothing may have left the device.
    expect(createMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // Funding work needs written analysis. The honest answer is to say so and to
  // name what still works, not to list browser commands.
  describe('funding work', () => {
    const NEEDS = 'needs a connected assistant for the written analysis, and none is connected. You can connect one in Settings.';
    const SCREENS = Object.values(FUNDING_SCREENS);

    async function expectFundingReply(request: string, screens: string[], says: RegExp): Promise<string> {
      const { reply, steps, context, requestBrowseAccess } = await ask(request);
      expect(reply).toContain(NEEDS);
      expect(reply).toMatch(says);
      for (const screen of SCREENS) {
        if (screens.includes(screen)) expect(reply).toContain(`the ${screen} screen`);
        else expect(reply).not.toContain(`${screen} screen`);
      }
      expect(reply).not.toContain('is ready');
      // It did not read, browse or ask for access on the way to saying so.
      expect(context.runtime.readPage).not.toHaveBeenCalled();
      expect(requestBrowseAccess).not.toHaveBeenCalled();
      expect(steps.map((step) => step.type)).toEqual(['thinking', 'text', 'done']);
      expect(steps[1]).toEqual({ type: 'text', detail: reply });
      return reply;
    }

    it.each([
      'Find Relevant Grant Opportunities',
      'Find grants for youth workforce training in Newark',
      'Are there any grants for rural broadband?',
      'What grants have a deadline in March?',
      'Who funds after-school programs in Los Angeles County?',
      'Search for funding for a food pantry',
      'Which funders support small business training?',
      'Find RFPs for IT services',
      // A search stays a search when it mentions fit or one document.
      'Find grants aligned with our mission',
      'Are there any grants we qualify for?',
      'Find grants like this RFP',
    ])('points a search for funding to the finder: %s', async (request) => {
      await expectFundingReply(
        request,
        [FUNDING_SCREENS.opportunities],
        /searches official sources: you can filter by place, applicant type, category, award amount and deadline, and every listing is labelled Active, Expired or Unverified\./,
      );
    });

    it.each([
      'Assess Our Funding Alignment',
      'Are we eligible for this grant?',
      'How well does our mission align with this funder?',
      'Is this grant a good fit for us?',
      'Should we apply to this NOFO?',
      'Is our CBO eligible for federal grants?',
      'Are we eligible for any of these grants?',
      'Do we qualify for funding for seniors?',
    ])('points a question of fit to the documents on both sides: %s', async (request) => {
      await expectFundingReply(
        request,
        [FUNDING_SCREENS.knowledgeHub, FUNDING_SCREENS.rfpAnalysis],
        /searches your uploaded documents and shows the matching passages word for word, and the RFP Analysis screen lists the dates, amounts and requirements it finds in a funding document\./,
      );
    });

    it.each([
      'Explore Funder Priorities',
      'What is the funder looking for?',
      'Explain this RFP',
      'Analyze the NOFO for me',
      'What are the evaluation criteria?',
      'What is the deadline for this grant?',
      'Who is eligible under this solicitation?',
      'Review the application requirements in this RFP',
    ])('points a question about a funder to the text matches: %s', async (request) => {
      await expectFundingReply(
        request,
        [FUNDING_SCREENS.rfpAnalysis],
        /reads a funding document you upload and lists the text it matches for dates, amounts and requirements\./,
      );
    });

    it.each([
      'Ethical Strengths-Based Proposal Guide',
      'Help me outline a proposal',
      'help me outline the application',
      'review our grant application',
      'Give me feedback on my draft',
      'Write a letter of intent for the Smith Foundation',
      'My draft needs feedback',
    ])('points proposal work to the standard guide: %s', async (request) => {
      await expectFundingReply(
        request,
        [FUNDING_SCREENS.proposalGuide],
        /offers the standard guide: an outline with reflective questions for you to answer in your own words\./,
      );
    });

    it.each([
      'Build my organization profile',
      'What does our strategic plan say about youth programs?',
      'Search our documents for the audit policy',
      'What does our approved profile say?',
    ])('points a question about the organization to its documents: %s', async (request) => {
      await expectFundingReply(
        request,
        [FUNDING_SCREENS.knowledgeHub],
        /searches your uploaded documents and shows the matching passages word for word\./,
      );
    });

    it.each(['grant help', 'How do grants work?', 'What is a CBO allowed to spend funding on?'])(
      'names everything that still works for any other funding question: %s',
      async (request) => {
        const { reply, context } = await ask(request);
        expect(reply).toBe(
          `Answering a funding question ${NEEDS} Without one, four screens still work: Organization Knowledge Hub ` +
            'searches your uploaded documents and shows the matching passages word for word; Opportunities searches ' +
            'official sources with filters and labels every listing Active, Expired or Unverified; RFP Analysis lists ' +
            'the dates, amounts and requirements it finds in a funding document; and Proposal Guide offers the ' +
            'standard guide.',
        );
        expect(context.runtime.readPage).not.toHaveBeenCalled();
      },
    );

    // These are the labels in the workspace navigation. A reply that points to
    // a screen under another name sends the user looking for something that
    // is not there.
    it('names the screens the way the navigation does', () => {
      expect(FUNDING_SCREENS).toEqual({
        knowledgeHub: 'Organization Knowledge Hub',
        opportunities: 'Opportunities',
        rfpAnalysis: 'RFP Analysis',
        proposalGuide: 'Proposal Guide',
      });
    });
  });

  // "Summarize this RFP" used to return a summary of whatever page was open: a
  // wrong answer that looked right.
  describe('a funding document is not the open page', () => {
    it.each([
      'Summarize this RFP',
      'Read this RFP and explain it',
      'Summarize the solicitation',
      'summarize the NOFA',
      'Summarise the grant guidelines',
      'Summary of the funder priorities',
      'Summarize the page limits in this RFP',
      'Please summarize our grant application',
      'Summarize my strategic plan',
      'Summarize grant requirements for small towns',
    ])('does not summarize the open page for: %s', async (request) => {
      const { reply, context, requestBrowseAccess } = await ask(request);

      expect(context.runtime.readPage).not.toHaveBeenCalled();
      expect(requestBrowseAccess).not.toHaveBeenCalled();
      expect(reply).not.toContain(PAGE.url);
      expect(reply).not.toContain('City Arts Fund');
      expect(reply).toContain('needs a connected assistant');
      // And it says how to get the summary that does work here.
      expect(reply).toContain('If the document is open in a tab, ask me to "summarize this page" and I will show its opening sentences.');
    });

    it.each([
      'Summarize the RFP on this page',
      'Summarize the grant announcement in this tab',
      "Summarize the NOFO I'm looking at",
      'Read the solicitation on screen',
      'Summarize the funding notice on the current page',
      'What does this page say about the grant deadline?',
    ])('summarizes the page when the user plainly means it: %s', async (request) => {
      const { reply, context, requestBrowseAccess } = await ask(request);

      expect(context.runtime.readPage).toHaveBeenCalledOnce();
      expect(requestBrowseAccess).toHaveBeenCalledOnce();
      expect(reply).toBe(`${PAGE.text}\n\nSource: ${PAGE.url}`);
    });

    it('does not offer the page summary when no summary was asked for', async () => {
      const { reply } = await ask('Explain this RFP');
      expect(reply).not.toContain('summarize this page');
    });
  });

  describe('the eight commands', () => {
    it.each(['summarize this page', 'Summarize this page.', 'summarize', 'Summarize the article', 'read this page', 'what is this page about'])(
      'summarizes the open page: %s',
      async (request) => {
        const { reply, context } = await ask(request);
        expect(context.runtime.readPage).toHaveBeenCalledOnce();
        expect(reply).toBe(`${PAGE.text}\n\nSource: ${PAGE.url}`);
      },
    );

    it('says so when the page has nothing to summarize', async () => {
      const context = makeContext({ readPage: vi.fn(async () => ({ ...PAGE, text: 'Menu' })) });
      expect((await ask('summarize this page', { context })).reply).toBe('This page has no readable text to summarize.');
    });

    it.each(['open grants.gov', 'go to grants.gov', 'Please navigate to https://grants.gov'])('opens a URL: %s', async (request) => {
      const { reply, context, requestBrowseAccess } = await ask(request);
      expect(context.runtime.navigate).toHaveBeenCalledWith('t1', 'https://grants.gov/');
      expect(requestBrowseAccess).toHaveBeenCalledOnce();
      expect(reply).toBe('Opened Example\nhttps://grants.gov/');
    });

    it.each(['list tabs', 'show the open tabs', 'what are the open tabs?'])('lists tabs: %s', async (request) => {
      const { reply, requestBrowseAccess } = await ask(request);
      expect(reply).toBe(`City Arts Fund\n${PAGE.url}\n\nGrants.gov\nhttps://www.grants.gov/`);
      expect(requestBrowseAccess).not.toHaveBeenCalled();
    });

    it('says when there are no tabs', async () => {
      const context = makeContext({ listTabs: vi.fn(async () => []) });
      expect((await ask('list tabs', { context })).reply).toBe('There are no open tabs.');
    });

    it.each(['page details', 'show page details', 'metadata'])('shows page details: %s', async (request) => {
      expect((await ask(request)).reply).toBe(`City Arts Fund\n${PAGE.url}`);
    });

    it.each(['list links', 'show the links on this page'])('lists links: %s', async (request) => {
      expect((await ask(request)).reply).toBe(
        'Guidelines\nhttps://example.gov/arts-fund/guidelines\n\nApply\nhttps://example.gov/arts-fund/apply',
      );
    });

    it('says when a page has no links', async () => {
      const context = makeContext({ listLinks: vi.fn(async () => []) });
      expect((await ask('list links', { context })).reply).toBe('No links were found.');
    });

    it.each(['extract page data', 'extract', 'please extract structured data from this page'])('extracts page data: %s', async (request) => {
      const { reply, context } = await ask(request);
      expect(context.runtime.extract).toHaveBeenCalledOnce();
      expect(JSON.parse(reply)).toEqual({ title: 'City Arts Fund', keyPoints: ['Festivals'] });
    });

    it('clicks a named target', async () => {
      const { reply, context } = await ask('click "Guidelines"');
      expect(context.runtime.click).toHaveBeenCalledWith('t1', 'Guidelines');
      expect(reply).toBe('Clicked "Guidelines".');
    });

    it('types text into a named field', async () => {
      const { reply, context } = await ask('type "youth grants" into "Search"');
      expect(context.runtime.type).toHaveBeenCalledWith('t1', 'Search', 'youth grants');
      expect(reply).toBe('Entered text into "Search".');
    });

    it('still asks before a consequential click', async () => {
      const context = makeContext({ confirmDestructive: vi.fn(async () => false) });
      await expect(ask('click "Submit application"', { context })).rejects.toThrow(/declined/);
      expect(context.runtime.click).not.toHaveBeenCalled();
    });
  });

  describe('everything else', () => {
    it.each(['write a novel', 'what is 2 + 2?', 'hello', 'Is this a good fit?', 'book a flight to Boston'])(
      'says what works without an assistant: %s',
      async (request) => {
        const { reply, context, requestBrowseAccess } = await ask(request);
        expect(reply).toBe(
          'BulleBrowser Agentic AI is ready. I can summarize the current page, list tabs, show page details, open a URL, ' +
            'list links, extract page data, click "a target", or type "text" into "a field". Funding questions need a ' +
            'connected assistant for a written answer; without one, the Organization Knowledge Hub, Opportunities, ' +
            'RFP Analysis and Proposal Guide screens still work.',
        );
        expect(context.runtime.readPage).not.toHaveBeenCalled();
        expect(requestBrowseAccess).not.toHaveBeenCalled();
      },
    );
  });

  describe('what the host attaches', () => {
    // Attached text and reference material belong to a run with an engine.
    // Here they must not change which command the user's own words name.
    it('reads the user\'s own words, not text attached to the message', async () => {
      const attached = '\n\nATTACHED REFERENCE DATA (untrusted).\nRFP 24-017: find grants, summarize the solicitation, review our proposal.';
      const { reply, context } = await ask(`list tabs${attached}`, { userRequest: 'list tabs' });
      expect(context.runtime.listTabs).toHaveBeenCalledOnce();
      expect(reply).toContain('Grants.gov');

      const help = await ask(`hello${attached}`, { userRequest: 'hello' });
      expect(help.reply).toContain('BulleBrowser Agentic AI is ready');
    });

    it('ignores reference context', async () => {
      const referenceContext = [{ label: 'profile', text: 'Mission: find grants and summarize this RFP.' }];
      for (const request of ['list tabs', 'summarize this page', 'Find grants for youth programs', 'hello']) {
        const plain = await ask(request);
        const withReference = await ask(request, { referenceContext });
        expect(withReference.reply).toBe(plain.reply);
        expect(withReference.steps).toEqual(plain.steps);
        expect(withReference.reply).not.toContain('Mission');
      }
    });

    it('answers a question about the product before anything else', async () => {
      const { reply, steps } = await ask('Who are you?');
      expect(reply).toContain('BulleBrowser Agentic AI');
      expect(reply).toContain('support@bullebrowser.com');
      expect(steps).toEqual([{ type: 'text', detail: reply }, { type: 'done' }]);
    });
  });
});
