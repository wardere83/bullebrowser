import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./store.js', () => ({
  createStore: <T extends Record<string, unknown>>(_name: string, defaults: T) => {
    let data: Record<string, unknown> = structuredClone(defaults);
    return {
      get: (key: string) => data[key],
      set: (key: string, value: unknown) => {
        data[key] = value;
      },
      _reset: () => {
        data = structuredClone(defaults);
      },
    };
  },
}));

const { conversationStore } = await import('./conversations.js');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const say = (id: string, content: string) =>
  conversationStore.appendMessage(id, { role: 'user', content, timestamp: Date.now() });

beforeEach(() => {
  (conversationStore as unknown as { store: { _reset(): void } }).store._reset();
});

describe('chats and organizations', () => {
  it('keeps a chat with the organization it was created under', () => {
    const a = conversationStore.create(ORG_A);
    const b = conversationStore.create(ORG_B);
    say(a.id, 'Our mission statement for the workforce grant');
    say(b.id, 'Furnace electrification funding');

    expect(conversationStore.list(ORG_A).map((c) => c.id)).toEqual([a.id]);
    expect(conversationStore.list(ORG_B).map((c) => c.id)).toEqual([b.id]);
    expect(conversationStore.list(null)).toEqual([]);
    // Reading across organizations finds nothing, even with the right id.
    expect(conversationStore.get(a.id, ORG_B)).toBeNull();
    expect(conversationStore.get(a.id, null)).toBeNull();
    expect(conversationStore.get(a.id, ORG_A)!.messages).toHaveLength(1);
  });

  it('shows chats from before organizations everywhere until they are bound', () => {
    const legacy = conversationStore.create();
    expect(conversationStore.list(ORG_A).map((c) => c.id)).toEqual([legacy.id]);
    expect(conversationStore.list(ORG_B).map((c) => c.id)).toEqual([legacy.id]);
    expect(conversationStore.list(null).map((c) => c.id)).toEqual([legacy.id]);

    expect(conversationStore.bind(legacy.id, ORG_A)).toBe(true);
    expect(conversationStore.list(ORG_A).map((c) => c.id)).toEqual([legacy.id]);
    expect(conversationStore.list(ORG_B)).toEqual([]);
    expect(conversationStore.get(legacy.id, ORG_B)).toBeNull();
  });

  it('never rebinds a chat to a different organization', () => {
    const chat = conversationStore.create(ORG_A);
    expect(conversationStore.bind(chat.id, ORG_A)).toBe(true);
    expect(conversationStore.bind(chat.id, ORG_B)).toBe(false);
    expect(conversationStore.get(chat.id, ORG_A)).not.toBeNull();
    expect(conversationStore.bind('missing', ORG_A)).toBe(false);
  });

  it('deletes only chats the asking organization can see', () => {
    const a = conversationStore.create(ORG_A);
    conversationStore.delete(a.id, ORG_B);
    expect(conversationStore.get(a.id, ORG_A)).not.toBeNull();
    conversationStore.delete(a.id, ORG_A);
    expect(conversationStore.get(a.id, ORG_A)).toBeNull();
  });

  it('removes an organization\'s chats with it and leaves the rest', () => {
    conversationStore.create(ORG_A);
    conversationStore.create(ORG_A);
    const other = conversationStore.create(ORG_B);
    const legacy = conversationStore.create();
    expect(conversationStore.deleteForOrganization(ORG_A)).toBe(2);
    expect(conversationStore.list().map((c) => c.id).sort()).toEqual([other.id, legacy.id].sort());
    expect(conversationStore.deleteForOrganization(ORG_A)).toBe(0);
  });

  it('behaves as before when no organization is given', () => {
    const one = conversationStore.create();
    const two = conversationStore.create(ORG_A);
    expect(conversationStore.list()).toHaveLength(2);
    expect(conversationStore.get(two.id)).not.toBeNull();
    conversationStore.delete(one.id);
    expect(conversationStore.list().map((c) => c.id)).toEqual([two.id]);
  });
});
