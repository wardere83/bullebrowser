// Choosing files to upload. A file's path always comes from the system dialog
// in the main process; the renderer asks for the dialog and never names a path.

import { type BrowserWindow, dialog } from 'electron';
import { ACCEPTED_EXTENSIONS } from '../../shared/funding.js';

export interface ChooseOptions {
  title: string;
  multiple: boolean;
}

export type ChooseFiles = (window: BrowserWindow, options: ChooseOptions) => Promise<string[]>;

type Stand = (options: ChooseOptions) => string[] | Promise<string[]>;
let standIn: Stand | null = null;

/**
 * Lets the end-to-end suite answer the dialog in place of a person, so no
 * system window opens during a hidden run. Never set in a normal launch.
 */
export function answerFileDialogForTests(answer: Stand | null): void {
  standIn = answer;
}

/** The files the user chose; an empty list when they dismissed the dialog. */
export const chooseDocuments: ChooseFiles = async (window, options) => {
  if (standIn) return [...(await standIn(options))];
  const result = await dialog.showOpenDialog(window, {
    title: options.title,
    buttonLabel: 'Upload',
    properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: 'Documents', extensions: Object.values(ACCEPTED_EXTENSIONS).flat() }],
  });
  return result.canceled ? [] : result.filePaths;
};
