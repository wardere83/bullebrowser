import { randomUUID } from 'node:crypto';
import type {
  ConversationDetail,
  ConversationSummary,
} from '../../shared/ipc.js';
import { createStore } from './store.js';
import { protectConversationIdentity } from '@bullebrowser/agent-core';

interface ConversationSchema extends Record<string, unknown> {
  conversations: ConversationDetail[];
}

class ConversationStore {
  private store = createStore<ConversationSchema>('conversations', {
    conversations: [],
  });

  // Chats can hold what an organization's documents say, so they are kept
  // apart like everything else an organization holds: a chat bound to one
  // organization is not listed, read or continued under another. Chats from
  // before organizations existed are unbound and visible everywhere until they
  // are used, at which point they are bound.
  private visibleTo(conversation: ConversationDetail, organizationId: string | null | undefined): boolean {
    if (organizationId === undefined) return true;
    const owner = conversation.organizationId ?? null;
    return owner === null || owner === organizationId;
  }

  /**
   * With no argument, every chat (the behaviour before organizations). With an
   * organization id, that organization's chats plus unbound ones. With null
   * (no organization is active), unbound chats only.
   */
  list(organizationId?: string | null): ConversationSummary[] {
    return this.store
      .get('conversations')
      .filter((conversation) => this.visibleTo(conversation, organizationId))
      .map(({ id, title, createdAt, updatedAt, messages }) => ({
        id,
        title,
        createdAt,
        updatedAt,
        messageCount: messages.length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** A chat by id. With an organization argument, null unless it is visible to it. */
  get(id: string, organizationId?: string | null): ConversationDetail | null {
    const conversation = this.store.get('conversations').find((c) => c.id === id);
    if (!conversation || !this.visibleTo(conversation, organizationId)) return null;
    return { ...conversation, messages: protectConversationIdentity(conversation.messages) };
  }

  create(organizationId?: string | null): ConversationDetail {
    const now = Date.now();
    const conv: ConversationDetail = {
      id: randomUUID(),
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      messages: [],
      ...(organizationId ? { organizationId } : {}),
    };
    const all = this.store.get('conversations');
    this.store.set('conversations', [conv, ...all]);
    return conv;
  }

  appendMessage(
    id: string,
    msg: { role: 'user' | 'assistant'; content: string; timestamp: number },
  ): ConversationDetail | null {
    const all = this.store.get('conversations');
    const idx = all.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    const conv = all[idx];
    if (!conv) return null;
    conv.messages.push(msg);
    conv.messageCount = conv.messages.length;
    conv.updatedAt = msg.timestamp;
    if (conv.title === 'New conversation' && msg.role === 'user') {
      conv.title = msg.content.slice(0, 60);
    }
    all[idx] = conv;
    this.store.set('conversations', all);
    return conv;
  }

  /**
   * Binds an unbound chat to an organization. Returns false when the chat is
   * missing or already belongs to a different one.
   */
  bind(id: string, organizationId: string): boolean {
    const all = this.store.get('conversations');
    const conversation = all.find((c) => c.id === id);
    if (!conversation) return false;
    const owner = conversation.organizationId ?? null;
    if (owner === organizationId) return true;
    if (owner !== null) return false;
    conversation.organizationId = organizationId;
    this.store.set('conversations', all);
    return true;
  }

  delete(id: string, organizationId?: string | null): void {
    this.store.set(
      'conversations',
      this.store
        .get('conversations')
        .filter((c) => c.id !== id || !this.visibleTo(c, organizationId)),
    );
  }

  /** Removes every chat bound to an organization, e.g. when it is deleted. */
  deleteForOrganization(organizationId: string): number {
    const all = this.store.get('conversations');
    const kept = all.filter((c) => (c.organizationId ?? null) !== organizationId);
    if (kept.length !== all.length) this.store.set('conversations', kept);
    return all.length - kept.length;
  }
}

export const conversationStore = new ConversationStore();
