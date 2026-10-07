import { test, expect, type Page, type Locator } from '@playwright/test';
import { createServer } from 'node:http';
import {
  launchApp,
  chooseFiles,
  documentsRead,
  fixture,
  freshUserData,
  removeUserData,
  scriptedAssistant,
  passageWith,
  standInForSources,
} from './funding-harness.js';

async function createOrganization(workspace: Locator, name: string) {
  await workspace.getByLabel('Organization name', { exact: true }).fill(name);
  await workspace.getByRole('radio', { name: /^CBO\b/ }).check();
  await workspace.getByRole('button', { name: 'Create organization', exact: true }).click();
  await workspace.getByRole('button', { name: 'Do this later', exact: true }).click();
}
async function open(win: Page, name: string) {
  await win
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name, exact: true })
    .click();
}

test('blank tabs show the funding video intro and webpages keep the browsing area', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Browsing area check</title><h1>This is the browsed page</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No browser test port');
  const url = `http://127.0.0.1:${address.port}/`;
  const { app, win, workspace, panel, userData } = await launchApp({ openFunding: false });
  try {
    await expect(panel).toBeVisible();
    await expect(workspace).toBeHidden();
    const intro = win.getByRole('region', { name: 'BulleBrowser funding introduction' });
    await expect(intro).toBeVisible();
    await expect(intro).toContainText('businesses and CBOs');
    await win.emulateMedia({ reducedMotion: 'no-preference' });
    const film = intro.locator('video');
    await expect.poll(() => film.evaluate((element: HTMLVideoElement) => ({
      loaded: element.readyState >= 2,
      width: element.videoWidth,
      muted: element.muted,
      playing: !element.paused,
    }))).toEqual({ loaded: true, width: 1920, muted: true, playing: true });
    await intro.getByRole('button', { name: 'Pause intro video', exact: true }).click();
    await expect.poll(() => film.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    await intro.getByRole('button', { name: 'Play intro video', exact: true }).click();
    await expect.poll(() => film.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => film.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    await expect(panel.locator('header')).not.toContainText('BulleBrowser Agentic AI');
    await expect(panel.getByRole('button', { name: 'History', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
    await win.getByRole('button', { name: 'Organization Knowledge Hub', exact: true }).click();
    await expect(workspace).toBeVisible();
    await expect(intro).toHaveCount(0);
    await expect(win.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);
    await win.getByRole('button', { name: 'Back to browsing', exact: true }).click();
    await expect(workspace).toBeHidden();
    await expect(intro).toBeVisible();
    await win.evaluate(async () => { await window.bullebrowser.tabs.create(); });
    await expect(workspace).toBeHidden();
    await expect(intro).toBeVisible();
    await win.evaluate(async (url) => { await window.bullebrowser.tabs.create(url); }, url);
    await expect.poll(() => app.evaluate(async ({ BrowserWindow }, url) => {
      const page = BrowserWindow.getAllWindows()[0]?.contentView.children.find((view) =>
        'webContents' in view && (view as import('electron').WebContentsView).webContents.getURL() === url,
      ) as import('electron').WebContentsView | undefined;
      if (!page) return null;
      return {
        title: await page.webContents.executeJavaScript('document.title'),
        visible: page.getVisible(),
        fillsPageSlot: page.getBounds().width > 300 && page.getBounds().height > 300,
      };
    }, url)).toMatchObject({ title: 'Browsing area check', visible: true, fillsPageSlot: true });
    await expect(workspace).toBeHidden();
    await expect(intro).toHaveCount(0);
    await win.screenshot({ path: '/tmp/bulle-browser-layout.png' });
  } finally {
    await app.close();
    removeUserData(userData);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('organization documents are searchable, reviewable, persistent and isolated; RFPs and guides work without a key', async () => {
  test.setTimeout(180000);
  const userData = freshUserData();
  let launched = await launchApp({ userData });
  try {
    let { app, win, workspace, panel } = launched;
    for (const name of [
      'Find Relevant Grant Opportunities',
      'Assess Your Funding Alignment',
      'Explore Funder Priorities',
      'Ethical Strengths-Based Proposal Guide',
    ]) {
      await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await createOrganization(workspace, 'Riverbend test CBO');
    await expect(panel).not.toContainText('Grounded in');
    await expect(panel).not.toContainText('profile not approved yet');
    await open(win, 'Organization Knowledge Hub');
    await expect(
      workspace.getByText(
        'Upload your organization’s documents so BulleBrowser aligns its guidance with your mission, priorities, strengths, and funding goals.',
        { exact: true },
      ),
    ).toBeVisible();
    await chooseFiles(app, [
      fixture('org-a', 'program-descriptions.md'),
      fixture('org-a', 'impact-report-2024.txt'),
    ]);
    await workspace.getByRole('button', { name: 'Upload documents', exact: true }).click();
    await documentsRead(app);
    await expect(workspace.getByText('Ready', { exact: true })).toHaveCount(2);
    await workspace
      .getByRole('button', { name: 'Inspect program-descriptions.md', exact: true })
      .click();
    await expect(win.getByRole('dialog')).toContainText('Harbor Lantern Collective');
    await win.getByRole('dialog').getByRole('button', { name: /Close/ }).click();
    await workspace.getByRole('tab', { name: 'Search', exact: true }).click();
    await workspace.getByLabel('Search organization documents').fill('workforce');
    await workspace.getByRole('button', { name: 'Search documents', exact: true }).click();
    await expect(workspace.getByRole('tabpanel')).toContainText('program-descriptions.md');
    await workspace.getByRole('tab', { name: 'Profile', exact: true }).click();
    await workspace
      .getByRole('button', { name: 'Draft profile from documents', exact: true })
      .click();
    await expect(
      workspace.getByRole('button', { name: 'Approve', exact: true }).first(),
    ).toBeVisible();
    await workspace.getByRole('button', { name: 'Approve', exact: true }).first().click();
    await expect(workspace.getByText('Approved', { exact: true }).first()).toBeVisible();
    await workspace.getByRole('tab', { name: 'Our Priorities', exact: true }).click();
    await workspace.getByRole('button', { name: 'Add a priority', exact: true }).click();
    await expect(win.getByRole('dialog')).toBeVisible();
    await win
      .getByRole('dialog')
      .getByRole('textbox')
      .first()
      .fill('Maintain our neighborhood workforce mission.');
    await win
      .getByRole('dialog')
      .getByRole('button', { name: 'Propose priority', exact: true })
      .click();
    await expect(
      workspace.locator('p').filter({ hasText: /^Maintain our neighborhood workforce mission\.$/ }),
    ).toBeVisible();
    await workspace.getByRole('button', { name: 'Approve', exact: true }).last().click();
    await win.screenshot({ path: '/tmp/bulle-funding-hub.png' });
    await open(win, 'RFP Analysis');
    await chooseFiles(app, [fixture('rfp', 'neighborhood-workforce-pathways-nofa.pdf')]);
    await workspace.getByRole('button', { name: 'Upload funding documents', exact: true }).click();
    await documentsRead(app);
    await workspace.getByRole('button', { name: 'Analyze funding document', exact: true }).click();
    await expect(
      workspace.getByRole('heading', { name: 'Dates, amounts and requirement passages' }),
    ).toBeVisible();
    await workspace.getByRole('tab', { name: 'Our alignment', exact: true }).click();
    await workspace.getByRole('button', { name: 'Assess funding alignment', exact: true }).click();
    await expect(
      workspace.getByRole('heading', { name: 'Assess Your Funding Alignment', exact: true }),
    ).toBeVisible();
    await workspace
      .getByRole('button', { name: 'Open ethical proposal guide', exact: true })
      .click();
    await workspace.getByRole('button', { name: 'Start ethical guide', exact: true }).click();
    await expect(
      workspace.getByRole('heading', { name: 'Funder rules on AI tools' }),
    ).toBeVisible();
    await app.close();
    launched = await launchApp({ userData });
    ({ app, win, workspace } = launched);
    await open(win, 'Organization Knowledge Hub');
    await expect(workspace.getByText('program-descriptions.md', { exact: true })).toBeVisible();
    await workspace.getByRole('tab', { name: 'Our Priorities', exact: true }).click();
    await expect(
      workspace.locator('p').filter({ hasText: /^Maintain our neighborhood workforce mission\.$/ }),
    ).toBeVisible();
    await win.getByRole('button', { name: /^Organization: Riverbend test CBO/ }).click();
    await win.getByRole('menuitem', { name: 'Add an organization', exact: true }).click();
    const dialog = win.getByRole('dialog', { name: 'Add an organization' });
    await dialog.getByLabel('Organization name', { exact: true }).fill('Separate test business');
    await dialog.getByRole('radio', { name: /^Business\b/ }).check();
    await dialog.getByRole('button', { name: 'Create organization', exact: true }).click();
    await open(win, 'Organization Knowledge Hub');
    await expect(workspace.getByText('No documents yet', { exact: true })).toBeVisible();
    await open(win, 'RFP Analysis');
    await expect(workspace.getByText('No funding documents yet', { exact: true })).toBeVisible();
    await open(win, 'Proposal Guide');
    await expect(workspace.getByText('No guides yet', { exact: true })).toBeVisible();
  } finally {
    await launched.app.close().catch(() => {});
    removeUserData(userData);
  }
});

test('official links use official-source adapters and a prohibited AI policy prevents tailored guide calls', async () => {
  const assistant = await scriptedAssistant((request) => {
    const purpose = passageWith(request.documents, 'These grants support');
    const awards = passageWith(request.documents, 'Awards of up to');
    const restriction = passageWith(request.documents, 'Applications drafted with generative AI');
    const evidence = (passage: { id: string; text: string }) => [
      { block_id: passage.id, quote: passage.text },
    ];
    const sections = Object.fromEntries(
      [
        'purpose',
        'priorities',
        'outcomes',
        'eligibility',
        'supported_activities',
        'award_amounts',
        'matching',
        'funding_period',
        'deadlines',
        'evaluation_criteria',
        'required_documents',
        'submission_steps',
        'reporting',
      ].map((id) => [id, { coverage: 'missing', note: 'Not stated in this reading.', items: [] }]),
    );
    sections.purpose = {
      coverage: 'stated',
      note: '',
      items: [{ text: purpose.text, basis: 'explicit', evidence: evidence(purpose) }],
    };
    sections.award_amounts = {
      coverage: 'stated',
      note: '',
      items: [{ text: awards.text, basis: 'explicit', evidence: evidence(awards) }],
    };
    return {
      overview: 'The funder supports neighborhood job skills projects.',
      sections,
      glossary: [],
      ai_use: {
        stance: 'prohibited',
        summary: 'Applications drafted with generative AI are disqualified.',
        evidence: evidence(restriction),
      },
      uncertainties: [],
      questions: [],
    };
  });
  const launched = await launchApp({ assistantUrl: assistant.url });
  const { app, win, workspace } = launched;
  try {
    await createOrganization(workspace, 'Policy test CBO');
    await standInForSources(app);
    await open(win, 'RFP Analysis');
    await workspace
      .getByLabel('Official funding link')
      .fill('https://www.grants.gov/search-results-detail/362880');
    await workspace.getByRole('button', { name: 'Read official link', exact: true }).click();
    await win
      .getByRole('dialog', { name: 'Search the official funding sources' })
      .getByRole('button', { name: 'Allow for this organization', exact: true })
      .click();
    await expect(workspace.getByLabel('Funding document', { exact: true })).not.toBeEmpty();
    await chooseFiles(app, [fixture('hostile', 'small-grants-notice-with-instructions.txt')]);
    await workspace.getByRole('button', { name: 'Upload funding documents', exact: true }).click();
    await documentsRead(app);
    await workspace.getByRole('button', { name: 'Analyze funding document', exact: true }).click();
    await win
      .getByRole('dialog', { name: 'Send document excerpts to the assistant' })
      .getByRole('button', { name: 'Allow for this organization', exact: true })
      .click();
    await expect(
      workspace.getByText('Applications drafted with generative AI are disqualified.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(assistant.requests).toHaveLength(1);
    // Check the schema the built app actually sent. The former inline format
    // was rejected by the real service before an analysis could begin.
    expect(assistant.requests[0]?.schema).toMatchObject({
      $defs: { section: { required: ['coverage', 'note', 'items'] } },
      properties: {
        sections: {
          properties: { award_amounts: { $ref: '#/$defs/section' } },
        },
      },
    });
    expect(assistant.requests[0]?.system).not.toContain('deadline has been waived');
    expect(assistant.requests[0]?.documents).toContain('deadline has been waived');
    await workspace.getByRole('tab', { name: 'Funder priorities', exact: true }).click();
    await expect(
      workspace.getByRole('heading', { name: 'Explore Funder Priorities', exact: true }),
    ).toBeVisible();
    await workspace
      .getByRole('button', { name: 'Open ethical proposal guide', exact: true })
      .click();
    await workspace.getByRole('button', { name: 'Start ethical guide', exact: true }).click();
    await expect(
      workspace.getByText('Reflective checklist only — AI use restricted', { exact: true }),
    ).toBeVisible();
    await expect(workspace.getByRole('textbox')).toHaveCount(0);
    expect(assistant.requests).toHaveLength(1);
    await win.screenshot({ path: '/tmp/bulle-funding-guide.png' });
  } finally {
    await app.close();
    removeUserData(launched.userData);
    await assistant.close();
  }
});

test('unreadable uploads report errors and deleting evidence invalidates approval, search and saved guidance', async () => {
  const launched = await launchApp();
  const { app, win, workspace } = launched;
  try {
    await createOrganization(workspace, 'Evidence test CBO');
    await open(win, 'Organization Knowledge Hub');
    await chooseFiles(app, [fixture('org-a', 'program-descriptions.md')]);
    await workspace.getByRole('button', { name: 'Upload documents', exact: true }).click();
    await documentsRead(app);
    await workspace.getByRole('tab', { name: 'Profile', exact: true }).click();
    await workspace
      .getByRole('button', { name: 'Draft profile from documents', exact: true })
      .click();
    await workspace.getByRole('button', { name: 'Approve', exact: true }).first().click();
    await open(win, 'Proposal Guide');
    await workspace.getByRole('button', { name: 'Start ethical guide', exact: true }).click();
    await expect(
      workspace.getByRole('heading', { name: 'Funder rules on AI tools' }),
    ).toBeVisible();
    await open(win, 'Organization Knowledge Hub');
    await chooseFiles(app, [
      fixture('invalid', 'image-only.pdf'),
      fixture('invalid', 'not-a-document.docx'),
    ]);
    await workspace.getByRole('button', { name: 'Upload documents', exact: true }).click();
    await documentsRead(app);
    await expect(workspace.getByText('Failed', { exact: true })).toHaveCount(2);
    await workspace
      .getByRole('button', { name: 'Delete program-descriptions.md', exact: true })
      .click();
    await win
      .getByRole('dialog', { name: 'Delete document' })
      .getByRole('button', { name: 'Delete document', exact: true })
      .click();
    await workspace.getByRole('tab', { name: 'Search', exact: true }).click();
    await workspace.getByLabel('Search organization documents').fill('workforce');
    await workspace.getByRole('button', { name: 'Search documents', exact: true }).click();
    await expect(workspace.getByText('No passages found', { exact: true })).toBeVisible();
    await workspace.getByRole('tab', { name: 'Profile', exact: true }).click();
    await expect(workspace.getByText('Approved', { exact: true })).toHaveCount(0);
    await open(win, 'Proposal Guide');
    await expect(
      workspace.getByText(/Your approved profile, source evidence or funding analysis changed/),
    ).toBeVisible();
    await expect(workspace.getByRole('textbox')).toHaveCount(0);
  } finally {
    await app.close();
    removeUserData(launched.userData);
  }
});
