// The only place that imports the PDF reader, because it has to be prepared for
// before it loads.
//
// The import is dynamic on purpose. The reader stays an external package in the
// built app, and a static import of an external package is hoisted above all
// other code in the bundled chunk, so the preparation below would run too late.
//
// It also belongs in a worker thread rather than the main process: on import it
// adds polyfills and extra names to the global objects of whatever loads it.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
// Types only: this line is erased, so it loads nothing ahead of the preparation below.
import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PdfJs = typeof PdfJsModule;

export interface LoadedPdfJs {
  pdfjs: PdfJs;
  /**
   * Where the character maps for Chinese, Japanese and Korean PDFs are, as a
   * plain path ending in "/". The reader fails on a file:// URL and on a path
   * without the trailing slash. This is the only location it is ever given.
   */
  cMapUrl: string;
}

interface Resolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

let loading: Promise<LoadedPdfJs> | null = null;

export function loadPdfjs(): Promise<LoadedPdfJs> {
  loading ??= load().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

async function load(): Promise<LoadedPdfJs> {
  // The reader expects a newer Node than the one unit tests run on. The app
  // itself has this method, in which case nothing happens here.
  const promises = Promise as unknown as { withResolvers?: <T>(this: PromiseConstructor) => Resolvers<T> };
  if (typeof promises.withResolvers !== 'function') {
    promises.withResolvers = function withResolvers<T>(this: PromiseConstructor): Resolvers<T> {
      let resolve!: Resolvers<T>['resolve'];
      let reject!: Resolvers<T>['reject'];
      const promise = new this<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }

  // Inert stand-ins for drawing classes: nothing is ever rendered, but the
  // reader looks for them when it loads.
  const scope = globalThis as Record<string, unknown>;
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
    if (!scope[name]) scope[name] = class {};
  }

  // It announces the missing drawing library while loading, before any option
  // could ask it not to. Only those lines are held back.
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Warning: ')) return;
    warn(...args);
  };
  let pdfjs: PdfJs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } finally {
    console.warn = warn;
  }

  const packageDir = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  return { pdfjs, cMapUrl: `${join(packageDir, 'cmaps')}/` };
}
