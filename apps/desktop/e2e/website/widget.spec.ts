import { expect, test } from '@playwright/test';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

// The embed widget (apps/web/public/widget.js) against a stand-in backend that
// keeps each stream open and answers /start only when the test says so. The
// same server stands in for the host page that embeds the widget.
const WIDGET = readFileSync(new URL('../../../web/public/widget.js', import.meta.url), 'utf8');
const PAGE = `<!doctype html><title>CRM</title><main>Contacts</main>
  <script src="/widget.js" data-endpoint="/api" data-title='Acme "CRM"' data-greeting="Ask me &lt;b&gt;anything&lt;/b&gt;"
    data-accent="red}&lt;/style&gt;&lt;i class=injected&gt;x&lt;/i&gt;&lt;style&gt;"></script>`;

async function backend() {
  const starts: { prompt: string; reply: (status: number) => void }[] = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
    if (req.url === '/widget.js') return void res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(WIDGET);
    if (req.url?.startsWith('/api/stream')) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(': open\n\n');
      return;
    }
    if (req.url === '/api/start') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => starts.push({ prompt: JSON.parse(body).prompt, reply: (status) => res.writeHead(status).end() }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { starts, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => { server.closeAllConnections(); server.close(); } };
}

test('configured title and greeting are shown as text, and a stopped run cannot end the next one', async ({ page }) => {
  const api = await backend();
  try {
    await page.goto(`${api.url}/`);
    await page.getByRole('button', { name: 'Open assistant' }).click();
    const panel = page.getByRole('dialog', { name: 'Acme "CRM"' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Ask me <b>anything</b>', { exact: true })).toBeVisible();
    await expect(panel.locator('.greet b')).toHaveCount(0);
    await expect(page.locator('.injected')).toHaveCount(0);
    await expect(panel.locator('textarea')).toHaveAttribute('placeholder', 'Ask Acme "CRM"…');

    const send = panel.locator('button.send');
    await panel.locator('textarea').fill('first task');
    await send.click();
    await expect.poll(() => api.starts.length).toBe(1);
    await expect(send).toHaveText('Stop');
    await send.click(); // Stop the first task while its /start is still in flight.
    await expect(send).toHaveText('Send');

    await panel.locator('textarea').fill('second task');
    await send.click();
    await expect.poll(() => api.starts.length).toBe(2);
    await expect(send).toHaveText('Stop');

    // The first task's /start is refused only now. That late reply belongs to
    // a run that has already ended, so the second run must keep going.
    api.starts[0].reply(403);
    api.starts[1].reply(200);
    await page.waitForTimeout(300);
    await expect(send).toHaveText('Stop');
    await expect(panel.getByText('Task not authorized or could not start')).toHaveCount(0);
  } finally {
    api.close();
  }
});
