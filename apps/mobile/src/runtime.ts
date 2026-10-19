import type {
  ActionPreview,
  KeyName,
  PermissionAsk,
  PermissionLevel,
  TabSummary,
  ToolRuntime,
} from '@bullebrowser/agent-core';
// Pure, audited desktop page helpers: same cursor, target inspection and previews.
import {
  AGENT_CURSOR,
  PAGE_HELPERS,
  EXTRACT_READABLE_TEXT,
  EXTRACT_STRUCTURED,
  LIST_LINKS,
  CLICK_FN,
  TYPE_FN,
  SCROLL_FN,
  PREVIEW_FN,
} from '../../desktop/src/main/agent/browser/page-scripts';
import type { NativeMobile } from './native';

export type Ask = (message: string, preview?: ActionPreview) => Promise<boolean>;
export class MobileRuntime implements ToolRuntime {
  activeTabId = '';
  private refs = new Map<string, { seq: number; fps: Record<string, unknown>; url: string }>();
  constructor(
    private native: NativeMobile,
    private ask: Ask,
    private signal: AbortSignal,
    private showBrowser: () => Promise<void>,
  ) {}
  async listTabs(): Promise<TabSummary[]> {
    return (await this.native.browser({ action: 'list' })).tabs ?? [];
  }
  async newTab(url = 'https://www.google.com/') {
    this.signal.throwIfAborted();
    await this.showBrowser();
    const tab = (await this.native.browser({ action: 'new', url })).tab;
    if (!tab) throw new Error('The browser could not open a tab.');
    this.activeTabId = tab.id;
    return tab;
  }
  async switchTab(tabId: string) {
    this.signal.throwIfAborted();
    await this.showBrowser();
    const tab = (await this.native.browser({ action: 'switch', tabId })).tab;
    if (!tab) throw new Error('Tab not found.');
    this.activeTabId = tab.id;
    return tab;
  }
  async closeTab(tabId: string) {
    this.signal.throwIfAborted();
    await this.native.browser({ action: 'close', tabId });
    this.refs.delete(tabId);
    this.activeTabId = (await this.listTabs()).find((tab) => tab.active)?.id ?? '';
    return { closed: true };
  }
  async navigate(tabId: string, url: string) {
    this.signal.throwIfAborted();
    await this.showBrowser();
    const tab = (await this.native.browser({ action: 'navigate', tabId, url })).tab;
    if (!tab) throw new Error('Navigation failed.');
    this.activeTabId = tab.id;
    this.refs.delete(tab.id);
    return { url: tab.url, title: tab.title };
  }
  private async evaluate<T>(tabId: string, expression: string): Promise<T> {
    this.signal.throwIfAborted();
    const tab = (await this.listTabs()).find((entry) => entry.id === tabId);
    if (!tab) throw new Error('Tab not found.');
    let refs = this.refs.get(tabId);
    if (!refs || refs.url !== tab.url) {
      refs = { seq: 0, fps: {}, url: tab.url };
      this.refs.set(tabId, refs);
    }
    const script = `${PAGE_HELPERS}; __bb.RefSeq=${refs.seq}; __bb.Refs=${JSON.stringify(refs.fps)}; ${AGENT_CURSOR}; return await (${expression.trim().replace(/;$/, '')});`;
    const result = await this.native.browser({ action: 'evaluate', tabId, script });
    this.signal.throwIfAborted();
    return result.value as T;
  }
  async readPage(tabId: string) {
    const data = await this.evaluate<{ text?: string; error?: string }>(
      tabId,
      EXTRACT_READABLE_TEXT,
    );
    if (!data.text)
      throw new Error(
        data.error ??
          'No readable text. Use the source tab manually if the editor is inaccessible.',
      );
    const tab = (await this.listTabs()).find((entry) => entry.id === tabId)!;
    return { title: tab.title, url: tab.url, text: data.text };
  }
  async findElements(tabId: string, query = '') {
    const result = await this.evaluate<{
      lines: string[];
      seq: number;
      fps: Record<string, unknown>;
    }>(tabId, `__bb.FindElements(${JSON.stringify(query)})`);
    const refs = this.refs.get(tabId)!;
    refs.seq = result.seq;
    Object.assign(refs.fps, result.fps);
    return { elements: result.lines.slice(0, 200) };
  }
  async inspectTarget(tabId: string, target: string | null, key: 'Enter' | 'Space' = 'Enter') {
    return this.evaluate<{ label: string; submitsForm: boolean; activates: boolean }>(
      tabId,
      `__bb.Facts(${target === null ? '__bb.Focused()' : `__bb.FindClickable(${JSON.stringify(target)})`}, ${JSON.stringify(target === null ? key : 'click')})`,
    );
  }
  async previewAction(tabId: string, target: string | null) {
    return this.evaluate<ActionPreview>(
      tabId,
      `(${PREVIEW_FN.toString()})(${JSON.stringify(target)})`,
    );
  }
  async click(tabId: string, target: string) {
    await this.switchTab(tabId);
    const matched = await this.evaluate<string>(
      tabId,
      `(${CLICK_FN.toString()})(${JSON.stringify(target)})`,
    );
    return { matched };
  }
  async type(tabId: string, target: string, text: string) {
    await this.switchTab(tabId);
    // Unsupported canvas editors fail visibly rather than report a successful DOM write.
    const inspected = await this.evaluate<boolean>(
      tabId,
      `(() => { const el=__bb.FindField(${JSON.stringify(target)}); return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement; })()`,
    );
    if (!inspected)
      throw new Error(
        'This mobile editor requires manual input. Open the source tab to continue; no text has been written.',
      );
    const result = await this.evaluate<{ matched: string; native: boolean }>(
      tabId,
      `(${TYPE_FN.toString()})(${JSON.stringify(target)}, ${JSON.stringify(text)})`,
    );
    if (result.native) throw new Error('Native editor input is unavailable on this surface.');
    return { matched: result.matched };
  }
  async selectOption(tabId: string, target: string, option: string) {
    return this.evaluate<{ matched: string }>(
      tabId,
      `({matched: __bb.Select(__bb.FindField(${JSON.stringify(target)}), ${JSON.stringify(option)})})`,
    );
  }
  async extract(tabId: string, schema: Record<string, unknown>) {
    const data = await this.evaluate<unknown>(tabId, EXTRACT_STRUCTURED);
    return { data: { schema, document: data, text: (await this.readPage(tabId)).text } };
  }
  async listLinks(tabId: string) {
    return this.evaluate<{ text: string; href: string }[]>(tabId, LIST_LINKS);
  }
  async getSelection(tabId: string) {
    return this.evaluate<{ text: string }>(tabId, `({text:String(getSelection() ?? '')})`);
  }
  async queryDom(tabId: string, selector: string) {
    return this.evaluate<{ matches: number }>(
      tabId,
      `({matches:__bb.DeepAll(${JSON.stringify(selector)}).length})`,
    );
  }
  async scroll(
    tabId: string,
    options: { direction: 'up' | 'down' | 'top' | 'bottom'; amount?: number },
  ) {
    const scrolledTo = await this.evaluate<number>(
      tabId,
      `(${SCROLL_FN.toString()})(${JSON.stringify(options.direction)}, ${JSON.stringify(options.amount ?? 600)})`,
    );
    return { scrolledTo };
  }
  async pressKey(tabId: string, key: KeyName) {
    if (key !== 'Enter' && key !== 'Space')
      throw new Error('Use the mobile keyboard for this key.');
    return this.evaluate<{ pressed: string }>(
      tabId,
      `(() => { const el=__bb.Focused(); if(el.form && ${JSON.stringify(key)}==='Enter') el.form.requestSubmit(); else if(el.matches('button,a,[role=button]')) el.click(); else throw Error('Use the mobile keyboard for this field.'); return {pressed:${JSON.stringify(key)}}; })()`,
    );
  }
  async waitFor(
    tabId: string,
    condition: { selector?: string; text?: string; timeoutMs?: number },
  ) {
    const deadline = Date.now() + Math.min(condition.timeoutMs ?? 10000, 10000);
    do {
      this.signal.throwIfAborted();
      if (
        await this.evaluate<boolean>(
          tabId,
          condition.selector
            ? `!!__bb.DeepQuery(${JSON.stringify(condition.selector)})`
            : condition.text
              ? `document.body.innerText.includes(${JSON.stringify(condition.text)})`
              : `document.readyState==='complete'`,
        )
      )
        return { matched: true };
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    return { matched: false };
  }
  async screenshot(): Promise<{ pngBase64: string }> {
    throw new Error(
      'Mobile screenshot capture is not enabled in this release. Read the page or use the source tab.',
    );
  }
  async goBack(tabId: string) {
    return this.history(tabId, 'back');
  }
  async goForward(tabId: string) {
    return this.history(tabId, 'forward');
  }
  async reload(tabId: string) {
    return this.history(tabId, 'reload');
  }
  private async history(tabId: string, action: string) {
    this.signal.throwIfAborted();
    const result = await this.native.browser({ action, tabId });
    return { url: result.tab?.url ?? '' };
  }
  async checkPermission(
    _tabId: string,
    level: PermissionLevel,
    ask: PermissionAsk,
  ): Promise<'granted' | 'confirmed' | 'denied'> {
    // Exact action each time; Settings never turns off consequential confirmations.
    if (level === 'read' || level === 'click') return 'granted';
    return (await this.ask(ask.action, ask.preview)) ? 'confirmed' : 'denied';
  }
  confirmDestructive(message: string, preview?: ActionPreview) {
    return this.ask(message, preview);
  }
}
