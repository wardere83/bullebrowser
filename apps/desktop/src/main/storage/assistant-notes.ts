// Notes the user asks the assistant to keep between conversations. They stay
// on this device, in their own store, and can be cleared on their own.

import { randomUUID } from 'node:crypto';
import { MAX_NOTES, noteLooksSensitive, type AssistantNote, type AssistantNotesStore } from '@bullebrowser/agent-core';
import { createStore } from './store.js';

interface NotesSchema extends Record<string, unknown> {
  notes: AssistantNote[];
}

class AssistantNotes implements AssistantNotesStore {
  private store = createStore<NotesSchema>('assistant-notes', { notes: [] });

  list(): AssistantNote[] {
    const notes = this.store.get('notes');
    return Array.isArray(notes)
      ? notes.filter((note) => note && typeof note.id === 'string' && typeof note.text === 'string' && !noteLooksSensitive(note.text))
      : [];
  }

  add(text: string): AssistantNote {
    const note: AssistantNote = { id: randomUUID().slice(0, 8), text, savedAt: Date.now() };
    this.store.set('notes', [...this.list(), note].slice(-MAX_NOTES));
    return note;
  }

  remove(id: string): boolean {
    const notes = this.list();
    const kept = notes.filter((note) => note.id !== id);
    this.store.set('notes', kept);
    return kept.length !== notes.length;
  }

  clear(): void {
    this.store.set('notes', []);
  }
}

export const assistantNotes = new AssistantNotes();
