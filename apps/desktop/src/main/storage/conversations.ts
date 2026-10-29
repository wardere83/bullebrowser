import { randomUUID } from 'node:crypto';
import type {
  ConversationDetail,
  TaskRunLog,
  ConversationSummary,
} from '../../shared/ipc.js';
import { createStore } from './store.js';
import { protectConversationIdentity, sanitizeAssistantText } from '@bullebrowser/agent-core';

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
    this.pruneTaskRuns();
    return this.store
      .get('conversations')
      .filter((conversation) => this.visibleTo(conversation, organizationId))
      .map(({ id, title, createdAt, updatedAt, messages }) => ({
        id,
        title: sanitizeAssistantText(title),
        createdAt,
        updatedAt,
        messageCount: messages.length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** A chat by id. With an organization argument, null unless it is visible to it. */
  get(id: string, organizationId?: string | null): ConversationDetail | null {
    this.pruneTaskRuns();
    const conversation = this.store.get('conversations').find((c) => c.id === id);
    if (!conversation || !this.visibleTo(conversation, organizationId)) return null;
    return { ...conversation, messages: protectConversationIdentity(conversation.messages).map((message) => message.role === 'assistant' ? { ...message, content: sanitizeAssistantText(message.content) } : message) };
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
    conv.messages.push(msg.role === 'assistant' ? { ...msg, content: sanitizeAssistantText(msg.content) } : msg);
    conv.messageCount = conv.messages.length;
    conv.updatedAt = msg.timestamp;
    if (conv.title === 'New conversation' && msg.role === 'user') {
      conv.title = msg.content.slice(0, 60);
    }
    all[idx] = conv;
    this.store.set('conversations', all);
    return conv;
  }

  /** Task activity is local, organization scoped, and expires after 30 days. */
  appendTaskRun(id: string, run: TaskRunLog): void {
    this.pruneTaskRuns();
    const all = this.store.get('conversations');
    const conversation = all.find((entry) => entry.id === id);
    if (!conversation) return;
    conversation.taskRuns = [...(conversation.taskRuns ?? []).filter((entry) => entry.id !== run.id), structuredClone(run)];
    this.store.set('conversations', all);
  }

  private pruneTaskRuns(): void {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const all = this.store.get('conversations');
    let changed = false;
    for (const conversation of all) {
      if (!conversation.taskRuns) continue;
      const kept = conversation.taskRuns.filter((run) => run.finishedAt >= cutoff);
      if (kept.length !== conversation.taskRuns.length) { conversation.taskRuns = kept; changed = true; }
    }
    if (changed) this.store.set('conversations', all);
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
