import { test, expect, type Locator, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  launchApp,
  chooseFiles,
  documentsRead,
  fixture,
  freshUserData,
  removeUserData,
  standInForSources,
} from './funding-harness.js';

const UPLOAD_ENTITY_INFO = /^Upload Entity[’']s Info$/;

async function organizationId(win: Page): Promise<string | null> {
  return win.evaluate(async () => {
    const identity = await window.bullebrowser.funding.identity.get();
    if (!identity.ok) throw Error(identity.error.message);
    return identity.value.session.organizationId;
  });
}

async function openWorkflow(panel: Locator, name: string) {
  await panel.getByRole('button', { name, exact: true }).click();
  await expect(panel.getByRole('button', { name, exact: true })).toHaveAttribute(
    'aria-current', 'true',
  );
}

test('entity upload beside History and New chat persists and grounds all four funding workflows without crossing entities', async () => {
  test.setTimeout(180_000);
  const userData = freshUserData();
  const entityFile = join(userData, 'entity-info.md');
  writeFileSync(entityFile, [
    '# Riverbend fixture CBO',
    '',
    '## Mission',
    'Our mission is to provide workforce training and job placement for neighborhood residents.',
    '',
    '## Strategic priorities',
    'Our strategic priority is workforce development through practical apprenticeship opportunities.',
    '',
    '## Funding goals',
    'We are seeking funding for workforce training and employment services.',
    '',
    'Fictional organization information for app testing.',
  ].join('\n'));

  let launched = await launchApp({ userData, openFunding: false });
  try {
    let { app, win, workspace, panel } = launched;
    const header = panel.locator('header');
    await expect(header.getByRole('button', { name: UPLOAD_ENTITY_INFO })).toBeVisible();
    await expect(header.getByRole('button')).toHaveText([
      'History', 'New chat', 'Upload Entity’s Info',
    ], { useInnerText: true });
    await header.getByRole('button', { name: UPLOAD_ENTITY_INFO }).click();
    await expect(workspace).toBeVisible();
    await workspace.getByLabel('Organization name', { exact: true }).fill('Riverbend fixture CBO');
    await workspace.getByRole('radio', { name: /^CBO\b/ }).check();
    await workspace.getByLabel('Country', { exact: true }).selectOption('US');
    await workspace.getByLabel(/^State or region\b/).selectOption('NJ');
    await workspace.getByLabel(/^City\b/).fill('Newark');
    await workspace.getByRole('button', { name: 'Create organization', exact: true }).click();
    await workspace.getByRole('button', { name: 'Do this later', exact: true }).click();
    const entityId = await organizationId(win);
    expect(entityId).toBeTruthy();

    await header.getByRole('button', { name: UPLOAD_ENTITY_INFO }).click();
    await expect(workspace.getByRole('tab', { name: 'Documents', exact: true })).toHaveAttribute(
      'aria-selected', 'true',
    );
    await chooseFiles(app, [entityFile]);
    await workspace.getByRole('button', { name: 'Upload documents', exact: true }).click();
    await documentsRead(app);
    await expect(workspace.getByText('Ready', { exact: true })).toHaveCount(1);
    await workspace.getByRole('button', { name: 'Review entity profile', exact: true }).click();
    await expect(workspace.getByRole('tab', { name: 'Profile', exact: true })).toHaveAttribute(
      'aria-selected', 'true',
    );
    await workspace.getByRole('button', { name: 'Draft profile from documents', exact: true }).click();
    const proposed = workspace.getByRole('checkbox', { name: /^Select to approve/ });
    await expect(proposed.first()).toBeVisible();
    const proposals = await proposed.all();
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) await proposal.check();
    await workspace.getByRole('button', { name: 'Approve selected', exact: true }).click();
    await expect(proposed).toHaveCount(0);
    const profile = await win.evaluate(async () => {
      const answer = await window.bullebrowser.funding.knowledge.getProfile();
      if (!answer.ok) throw Error(answer.error.message);
      return answer.value;
    });
    expect(profile.organizationId).toBe(entityId);
    expect(profile.approvedAt).not.toBeNull();
    const approvedIds = profile.claims.filter((claim) => claim.status === 'approved').map((claim) => claim.id);
    expect(approvedIds.length).toBeGreaterThan(0);

    // Choosing discovery reads the reviewed entity profile and starts a real
    // source-adapter search. No separate "Use profile" or "Search" click is needed.
    await standInForSources(app);
    await openWorkflow(panel, 'Find Relevant Grant Opportunities');
    await expect(workspace.getByRole('heading', { name: 'Opportunities', exact: true })).toBeVisible();
    const consent = win.getByRole('dialog', { name: 'Search the official funding sources' });
    await expect(consent).toBeVisible();
    await consent.getByRole('button', { name: 'Allow for this organization', exact: true }).click();
    await expect(workspace).toContainText(/Read from \d+ official source/);
    await expect(workspace.getByRole('heading', {
      name: 'Fiscal Year (FY) 2027 AmeriCorps Seniors RSVP Competition', exact: true,
    })).toBeVisible();
    await workspace.locator('summary').filter({ hasText: /^Who may apply/ }).click();
    await expect(workspace.getByRole('checkbox', { name: 'CBOs and other nonprofits', exact: true })).toBeChecked();
    await workspace.locator('summary').filter({ hasText: /^Funding category/ }).click();
    await expect(workspace.getByRole('checkbox', { name: 'Employment and workforce', exact: true })).toBeChecked();
    await workspace.locator('summary').filter({ hasText: /^Place/ }).click();
    await expect(workspace.getByLabel('Country', { exact: true })).toHaveValue('US');
    await expect(workspace.getByLabel(/^State or region\b/)).toHaveValue('NJ');
    await expect(workspace.getByLabel(/^City\b/)).toHaveValue('Newark');
    expect(await organizationId(win)).toBe(entityId);

    await openWorkflow(panel, 'Assess Your Funding Alignment');
    await expect(workspace.getByRole('heading', { name: 'RFP Analysis', exact: true })).toBeVisible();
    await chooseFiles(app, [fixture('rfp', 'neighborhood-workforce-pathways-nofa.pdf')]);
    await workspace.getByRole('button', { name: 'Upload funding documents', exact: true }).click();
    await documentsRead(app);
    await expect(workspace.getByRole('tab', { name: 'Our alignment', exact: true })).toHaveAttribute('aria-selected', 'true');
    await workspace.getByRole('tab', { name: 'Analysis', exact: true }).click();
    await workspace.getByRole('button', { name: 'Analyze funding document', exact: true }).click();
    await expect(workspace.getByRole('heading', { name: 'Dates, amounts and requirement passages' })).toBeVisible();
    await openWorkflow(panel, 'Assess Your Funding Alignment');
    await workspace.getByRole('button', { name: 'Assess funding alignment', exact: true }).click();
    await expect(workspace.getByRole('heading', { name: 'Assess Your Funding Alignment', exact: true })).toBeVisible();
    const rfpId = await workspace.getByLabel('Funding document', { exact: true }).inputValue();
    const alignment = await win.evaluate(async (id) => {
      const answer = await window.bullebrowser.funding.rfps.alignment(id);
      if (!answer.ok) throw Error(answer.error.message);
      return answer.value;
    }, rfpId);
    expect(alignment?.organizationId).toBe(entityId);
    expect(alignment?.profileApprovedAt).toBe(profile.approvedAt);
    expect(alignment?.profileClaimIds?.sort()).toEqual([...approvedIds].sort());
    expect(alignment?.stale).toBe(false);

    await openWorkflow(panel, 'Explore Funder Priorities');
    await expect(workspace.getByRole('tab', { name: 'Funder priorities', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(workspace.getByRole('heading', { name: 'Explore Funder Priorities', exact: true })).toBeVisible();
    await expect(workspace.getByLabel('Funding document', { exact: true })).toHaveValue(rfpId);
    expect(await organizationId(win)).toBe(entityId);

    await openWorkflow(panel, 'Ethical Strengths-Based Proposal Guide');
    await workspace.getByRole('button', { name: 'Start ethical guide', exact: true }).click();
    await expect(workspace.getByRole('heading', { name: 'Funder rules on AI tools' })).toBeVisible();
    const guides = await win.evaluate(async () => {
      const answer = await window.bullebrowser.funding.guides.list();
      if (!answer.ok) throw Error(answer.error.message);
      return answer.value;
    });
    expect(guides).toHaveLength(1);
    expect(guides[0]?.organizationId).toBe(entityId);
    expect(guides[0]?.profileApprovedAt).toBe(profile.approvedAt);
    expect(guides[0]?.profileClaimIds?.sort()).toEqual([...approvedIds].sort());
    expect(guides[0]?.outline.flatMap((section) => section.strengths).some((fact) => approvedIds.includes(fact.claimId ?? ''))).toBe(true);

    await app.close();
    launched = await launchApp({ userData, openFunding: false });
    ({ app, win, workspace, panel } = launched);
    await panel.getByRole('button', { name: UPLOAD_ENTITY_INFO }).click();
    await expect(workspace.getByText('entity-info.md', { exact: true })).toBeVisible();
    expect(await organizationId(win)).toBe(entityId);
    await workspace.getByRole('tab', { name: 'Profile', exact: true }).click();
    await expect(workspace.getByText('Approved', { exact: true })).toHaveCount(approvedIds.length);

    // A new entity cannot inherit the first entity's documents, reviewed
    // statements, funding notices, alignment reports or proposal guides.
    await win.getByRole('button', { name: /^Organization: Riverbend fixture CBO/ }).click();
    await win.getByRole('menuitem', { name: 'Add an organization', exact: true }).click();
    const dialog = win.getByRole('dialog', { name: 'Add an organization' });
    await dialog.getByLabel('Organization name', { exact: true }).fill('Separate fixture business');
    await dialog.getByRole('radio', { name: /^Business\b/ }).check();
    await dialog.getByRole('button', { name: 'Create organization', exact: true }).click();
    await panel.getByRole('button', { name: UPLOAD_ENTITY_INFO }).click();
    await expect(workspace.getByText('No documents yet', { exact: true })).toBeVisible();
    expect(await organizationId(win)).not.toBe(entityId);
    const separateProfile = await win.evaluate(async () => {
      const answer = await window.bullebrowser.funding.knowledge.getProfile();
      if (!answer.ok) throw Error(answer.error.message);
      return answer.value;
    });
    expect(separateProfile.claims).toHaveLength(0);
    await openWorkflow(panel, 'Find Relevant Grant Opportunities');
    await expect(workspace.getByText('Nothing has been searched yet', { exact: true })).toBeVisible();
    await openWorkflow(panel, 'Assess Your Funding Alignment');
    await expect(workspace.getByText('No funding documents yet', { exact: true })).toBeVisible();
    await openWorkflow(panel, 'Explore Funder Priorities');
    await expect(workspace.getByText('No funding documents yet', { exact: true })).toBeVisible();
    await openWorkflow(panel, 'Ethical Strengths-Based Proposal Guide');
    await expect(workspace.getByText('No guides yet', { exact: true })).toBeVisible();
  } finally {
    await launched.app.close().catch(() => {});
    removeUserData(userData);
  }
});
