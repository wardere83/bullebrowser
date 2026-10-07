// The workspace is on screen at first launch, beside the assistant panel, and
// the app's end-to-end tests find the panel's controls by role, name and text
// with nothing to tell them apart from the workspace. So a set of names, texts
// and elements is reserved: if the workspace used one, those tests would find
// two matches, or the wrong one.
//
// This test reads every source file of the workspace and checks what can reach
// the screen (string literals and the text inside JSX) against that set. It
// also checks one rule of the product's wording. When it fails, rename the
// thing in the workspace; do not change the list.
//
// Words for backing out that are free to use: "Not now", "Back", "Keep",
// "Discard", "Dismiss".

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(here, '..');

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

/** Everything the workspace is made of, tests included. */
const ALL_FILES = [
  ...filesUnder(here),
  join(rendererRoot, 'lib', 'funding-client.ts'),
  join(rendererRoot, 'lib', 'funding-client.test.ts'),
  join(rendererRoot, 'state', 'workspace-store.ts'),
];
/** What ships: the files whose text can reach the screen. */
const SOURCE_FILES = ALL_FILES.filter((path) => !isTest(path));

interface Finding {
  rule: string;
  text: string;
}

/** A name no workspace button may contain, in any capitals. */
const NAME_MUST_NOT_CONTAIN = ['cancel', 'your assistant', 'stop voice mode', 'upload your file'];

/** Text that must not appear anywhere in the workspace, in any capitals. */
const TEXT_MUST_NOT_CONTAIN = [
  'starting microphone',
  'retained for 8 days',
  'research summary',
  'live voice mode',
  'bullebrowser agent',
  'md-prose',
  'chat-user-message',
];

/** A name or text that must not be used on its own, exactly as written. */
const MUST_NOT_EQUAL = [
  'Send',
  'Close',
  'History',
  'Stop',
  'Allow Access',
  'Update App',
  'Add attachment',
  'Voice input',
  'Voice Mode',
  'Mute microphone',
  'Unmute microphone',
  'Upload your file',
  'Screenshot',
  'Projects',
  'Control Browser',
  'Chat history',
  'Settings',
  'Open source',
  'Assistant chat',
  'complementary',
];

/** Code values that contain a reserved word but are never shown: a job's state and an error code. */
const NOT_SHOWN = new Set(['cancelled', 'CANCELLED']);

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

/** What a source file can put on screen, and the elements it renders. */
function inspect(fileName: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const check = (raw: string) => {
    const text = tidy(raw);
    if (!text || NOT_SHOWN.has(text)) return;
    const lower = text.toLowerCase();
    for (const word of [...NAME_MUST_NOT_CONTAIN, ...TEXT_MUST_NOT_CONTAIN]) {
      if (lower.includes(word)) findings.push({ rule: `contains "${word}"`, text });
    }
    if (MUST_NOT_EQUAL.includes(text)) findings.push({ rule: `is exactly "${text}"`, text });
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return; // module paths
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) check(node.text);
    else if (ts.isTemplateExpression(node)) {
      check(node.head.text);
      for (const span of node.templateSpans) check(span.literal.text);
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      if (tag === 'aside') findings.push({ rule: 'renders an <aside>', text: tag });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

describe('the checker itself', () => {
  const found = (source: string) => inspect('sample.tsx', source).map((finding) => finding.rule);

  it('catches a reserved name, wherever the words come from', () => {
    expect(found('const a = <button>Cancel upload</button>;')).toEqual(['contains "cancel"']);
    expect(found('const a = <Button>{busy ? "Cancelling" : "Go"}</Button>;')).toEqual([
      'contains "cancel"',
    ]);
    expect(found('const a = <IconButton label="Close" icon="x" />;')).toEqual([
      'is exactly "Close"',
    ]);
    expect(found('const label = `Stop Voice Mode for ${name}`;')).toEqual([
      'contains "stop voice mode"',
    ]);
    expect(found('const a = <h2>Research summary</h2>;')).toEqual(['contains "research summary"']);
    expect(found('const a = <div className="md-prose selectable" />;')).toEqual([
      'contains "md-prose"',
    ]);
    expect(found('const a = <aside aria-label="Filters" />;')).toEqual(['renders an <aside>']);
    expect(found('const a = <div role="complementary" />;')).toEqual([
      'is exactly "complementary"',
    ]);
    expect(found('const a = <h1>\n  Settings\n</h1>;')).toEqual(['is exactly "Settings"']);
  });

  it('leaves alone what only looks similar', () => {
    expect(found('const a = <IconButton label="Close dialog" icon="x" />;')).toEqual([]);
    expect(found('const a = <Button>Stop job</Button>;')).toEqual([]);
    expect(found('const a = <button>Open Settings</button>;')).toEqual([]);
    expect(found("if (job.state === 'cancelled' || error.code === 'CANCELLED') stop();")).toEqual(
      [],
    );
    expect(found('await fundingBridge().jobs.cancel(jobId);')).toEqual([]);
    expect(found('// A comment may say Cancel, or md-prose, or <aside>.\nconst a = 1;')).toEqual(
      [],
    );
    expect(found("import { Send } from './Send.js';")).toEqual([]);
  });
});

describe('the workspace', () => {
  it('has source files to check', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(30);
  });

  it('uses no name, text or element reserved by the end-to-end tests', () => {
    const problems = SOURCE_FILES.flatMap((path) =>
      inspect(path, readFileSync(path, 'utf8')).map(
        (finding) => `${relative(rendererRoot, path)}: ${finding.rule} in "${finding.text}"`,
      ),
    );
    expect(problems).toEqual([]);
  });

  it('writes the acronym and never spells it out, in copy, labels, comments and tests', () => {
    // Built from its parts so that this file obeys the rule it checks.
    const spelledOut = new RegExp(['community', 'based', 'organi[sz]ations?'].join('[\\s-]+'), 'i');
    const offenders = ALL_FILES.filter((path) => spelledOut.test(readFileSync(path, 'utf8'))).map(
      (path) => relative(rendererRoot, path),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps to plain wording: no exclamation marks in what is shown', () => {
    const shouted: string[] = [];
    for (const path of SOURCE_FILES) {
      const file = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node) => {
        // Sentences only: a string with a space in it that ends in "!" or has "! " inside.
        if (
          (ts.isStringLiteralLike(node) || ts.isJsxText(node)) &&
          /\w!(\s|$)/.test(node.text) &&
          /\s/.test(tidy(node.text))
        ) {
          shouted.push(`${relative(rendererRoot, path)}: "${tidy(node.text)}"`);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(shouted).toEqual([]);
  });
});
