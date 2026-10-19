import { test, expect } from '@playwright/test';
import { MobileRuntime } from '../../../mobile/src/runtime';
import type { NativeMobile } from '../../../mobile/src/native';

test('mobile adapter executes the real shared page scripts against HTML', async ({ page }) => {
  await page.setContent(
    '<main><h1>Official grant portal</h1><p>Applications close on December 15.</p><form><label>Name<input name="name"></label><label>Program<select><option>Health</option><option>Education</option></select></label><button>Submit application</button></form><a href="https://agency.gov/opportunity">Official source</a></main>',
  );
  await page.evaluate(() => {
    document.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      document.body.dataset.submitted = 'yes';
    });
  });
  const native = {
    browser: async (input: { action: string; script?: string }) => {
      const tab = { id: 'tab', active: true, title: 'Grant portal', url: 'https://agency.gov/' };
      if (input.action === 'list') return { tabs: [tab] };
      if (input.action === 'switch') return { tab };
      if (input.action === 'evaluate')
        return {
          value: await page.evaluate(async (script) => {
            const execute = new Function(`return (async()=>{${script}})()`);
            return await execute();
          }, input.script!),
        };
      throw Error('Unsupported fixture operation.');
    },
  } as unknown as NativeMobile;
  const runtime = new MobileRuntime(
    native,
    async () => false,
    new AbortController().signal,
    async () => {},
  );
  await runtime.presentAction('tab');
  await expect(page.locator('#__bb_agent_cursor__')).toHaveCount(1);
  expect((await runtime.readPage('tab')).text).toContain('Applications close');
  expect((await runtime.listLinks('tab'))[0]!.href).toBe('https://agency.gov/opportunity');
  const found = await runtime.findElements('tab');
  expect(found.elements.join('\n')).toContain('Name');
  await runtime.type('tab', 'Name', 'Example organization');
  expect(await page.getByLabel('Name').inputValue()).toBe('Example organization');
  await runtime.selectOption('tab', 'Program', 'Education');
  expect(await page.getByLabel('Program').inputValue()).toBe('Education');
  const facts = await runtime.inspectTarget('tab', 'Submit application');
  expect(facts.submitsForm).toBe(true);
  const preview = await runtime.previewAction('tab', 'Submit application');
  expect(preview.fields).toEqual(
    expect.arrayContaining([{ label: 'Name', value: 'Example organization' }]),
  );
  expect(
    await runtime.checkPermission('tab', 'full', { action: 'Submit application', preview }),
  ).toBe('denied');
  expect(await page.evaluate(() => document.body.dataset.submitted)).toBeUndefined();
  expect((await runtime.extract('tab', {})).data).toHaveProperty('document');
});
