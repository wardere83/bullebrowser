import type { BrowserTaskId } from '@bullebrowser/agent-core';
export const SAVE_UPDATE_CHAT_EVENT = 'bullebrowser:save-update-chat';
const KEY = 'bullebrowser:update-chat';
export interface UpdateChatSnapshot { chat?: UpdateChat }
export interface UpdateChat { conversationId: string; draft: string; browserTask?: BrowserTaskId }
export function saveUpdateChat(chat: UpdateChat): void {
  window.localStorage.setItem(KEY, JSON.stringify(chat));
}
export function takeUpdateChat(): UpdateChat | null {
  const value = window.localStorage.getItem(KEY);
  try {
    const chat = value ? JSON.parse(value) as UpdateChat : null;
    return chat && typeof chat.conversationId === 'string' && typeof chat.draft === 'string' ? chat : null;
  } catch { return null; }
}
export function clearUpdateChat(): void { window.localStorage.removeItem(KEY); }
