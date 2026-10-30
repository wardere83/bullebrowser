/** Short lived, per-task cache. No persistence or cross-tab reuse. */
export class ElementMapCache<T> {
  private entries = new Map<string, { url: string; query: string; at: number; value: T }>();
  constructor(private readonly now = Date.now, private readonly ttlMs = 2000) {}
  get(tabId: string, url: string, query = ''): T | undefined {
    const entry = this.entries.get(tabId);
    if (!entry || entry.url !== url || entry.query !== query || this.now() - entry.at >= this.ttlMs) return undefined;
    return structuredClone(entry.value);
  }
  set(tabId: string, url: string, query: string, value: T): void {
    this.entries.set(tabId, { url, query, at: this.now(), value: structuredClone(value) });
  }
  invalidate(tabId: string): void { this.entries.delete(tabId); }
}
