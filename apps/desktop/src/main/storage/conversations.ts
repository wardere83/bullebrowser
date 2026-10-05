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

  list(): ConversationSummary[] {
    return this.store
      .get('conversations')
      .map(({ id, title, createdAt, updatedAt, messages }) => ({
        id,
        title,
        createdAt,
        updatedAt,
        messageCount: messages.length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): ConversationDetail | null {
    const conversation = this.store.get('conversations').find((c) => c.id === id);
    return conversation ? { ...conversation, messages: protectConversationIdentity(conversation.messages) } : null;
  }

  create(): ConversationDetail {
    const now = Date.now();
    const conv: ConversationDetail = {
      id: randomUUID(),
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      messages: [],
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

  delete(id: string): void {
    this.store.set(
      'conversations',
      this.store.get('conversations').filter((c) => c.id !== id),
    );
  }
}

export const conversationStore = new ConversationStore();
