// Checks the website's copy against the rules it has to keep.
//
//   node scripts/check-copy.mjs     (from apps/web; exits 1 on any problem)
//
// 1. The five dictionaries define exactly the same keys.
// 2. "CBOs" is never spelled out, in any of the five languages, in the source
//    or in the exported site.
// 3. Names, figures and sentence endings survive translation, and the fixed
//    wording is word for word.
// 4. No retired, client or vendor wording appears anywhere.
// 5. If the site has been built (out/ exists), every exported page has one h1,
//    headings that never skip a level, its landmarks and its metadata.
//
// The words this looks for are assembled from pieces, so that the file can
// scan itself without tripping over its own list.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(WEB, '../..');
const OUT = path.join(WEB, 'out');
const ts = createRequire(import.meta.url)('typescript');

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);
const join = (...parts) => parts.join('');

function loadDictionary(file, exportName) {
  const source = readFileSync(path.join(WEB, 'lib/locales', file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, require: () => ({}) });
  return module.exports[exportName];
}

const dictionaries = {
  en: loadDictionary('en.ts', 'en'),
  fr: loadDictionary('fr.ts', 'fr'),
  ar: loadDictionary('ar.ts', 'ar'),
  'es-419': loadDictionary('es-419.ts', 'es419'),
  'pt-PT': loadDictionary('pt-PT.ts', 'ptPT'),
};
const english = dictionaries.en;
const keys = Object.keys(english);

// The acronym's long form in each language, hyphenated or not.
const SPELLED_OUT = [
  new RegExp(join('commu', 'nity[\\s-]*ba', 'sed'), 'i'),
  new RegExp(join('organis(?:ation|me)s?\\s+commu', 'nautaires?|base\\s+commu', 'nautaire'), 'i'),
  new RegExp(join('organizaci(?:ó|o)n(?:es)?\\s+comu', 'nitarias?|base\\s+comu', 'nitaria'), 'i'),
  new RegExp(
    join('organiza(?:ç|c)(?:ã|a)o\\s+comu', 'nit(?:á|a)ria|organiza(?:ç|c)(?:õ|o)es\\s+comu', 'nit(?:á|a)rias'),
    'i',
  ),
  new RegExp(join('منظم(?:ة|ات)\\s+(?:ال)?مجت', 'معي|المنظمات\\s+المجت', 'معية|منظمات\\s+المجت', 'مع')),
];

// Wording that was true of an earlier product, or names a client or a vendor.
const RETIRED = [
  ['client term', new RegExp(join('\\bE', 'EO\\b|\\bC', 'RM\\b|live\\s?', 'chat|suite', 'dash'), 'i')],
  ['retired positioning', new RegExp(join('navigates for ', 'you|agentic ', 'browser|compliance ', '(?:review|checklist)'), 'i')],
  ['inaccurate key-storage claim', new RegExp(join('key', 'chain|lib', 'secret|DP', 'API'), 'i')],
  [
    'vendor or model name',
    new RegExp(join('\\bAnth', 'ropic\\b|\\bOpen', 'AI\\b|\\bHugging\\s?', 'Face\\b|\\bCl', 'aude\\b|sk-', 'ant'), 'i'),
  ],
];

// What must read the same in every language wherever the English has it.
const KEPT = [
  'BulleBrowser',
  'Bulle Consulting',
  'Grants.gov',
  'PDF',
  'DOCX',
  'TXT',
  'Markdown',
  'RFP',
  'GitHub',
  'macOS',
  'Windows',
  'Linux',
  'SmartScreen',
  'Developer ID',
  'SHA-256',
  'Organization Knowledge Hub',
  'Our Priorities',
  'Find Relevant Grant Opportunities',
  'What can I help you with?',
  'Your Assistant',
  'Update App',
];

const FIXED = {
  'ask.h2': 'What can I help you with?',
  'hub.description':
    "Upload your organization's documents so BulleBrowser aligns its guidance with your mission, priorities, strengths, and funding goals.",
  'privacy.5': 'Keys are encrypted and stored on this device.',
  'common.illustration': 'Illustration — sample data, not a live listing',
  'footer.tagline': 'The strategic funding platform for businesses and CBOs.',
};

// Figures, with thousands separators and spacing folded away.
const figures = (text) =>
  (text.match(/\d(?:[\d.,   ]*\d)?/g) ?? [])
    .map((figure) => figure.replace(/[,   ]/g, '').replace(/\.(?=\d{3}(?!\d))/g, ''))
    .sort()
    .join(' ');

const ending = (text) => {
  const last = text.replace(/[»”’)‎‏\s]+$/u, '').slice(-1);
  if (last === '.') return 'a full stop';
  if (last === '?' || last === '؟') return 'a question mark';
  if (last === ':') return 'a colon';
  if (last === '…') return 'an ellipsis';
  return 'no punctuation';
};

for (const [locale, dictionary] of Object.entries(dictionaries)) {
  const own = Object.keys(dictionary);
  for (const key of keys) if (!(key in dictionary)) fail(`[${locale}] ${key}`, 'missing');
  for (const key of own) if (!(key in english)) fail(`[${locale}] ${key}`, 'not in the English dictionary');

  for (const key of own) {
    const value = dictionary[key];
    const where = `[${locale}] ${key}`;
    if (typeof value !== 'string' || !value.trim()) {
      fail(where, 'empty');
      continue;
    }
    // The fixed sentences are the owner's own wording, kept character for
    // character, so the typography rule does not apply to them.
    const fixed = locale === 'en' && Object.hasOwn(FIXED, key);
    if (!fixed && /["']/.test(value)) fail(where, 'straight quotation mark or apostrophe');
    if (/ {2,}|^\s|\s$/.test(value)) fail(where, 'stray whitespace');

    const source = english[key];
    if (locale === 'en' || typeof source !== 'string') continue;
    for (const term of KEPT) {
      // The section heading that asks the app's opening question is translated;
      // the app's own wording of it is quoted in the install guide.
      if (key === 'ask.h2' && term === FIXED['ask.h2']) continue;
      if (source.includes(term) && !value.includes(term)) fail(where, `lost “${term}”`);
    }
    for (const acronym of [/\bCBOs\b/, /\bCBO\b/]) {
      if (acronym.test(source) !== acronym.test(value)) fail(where, `${acronym.source} does not match the English`);
    }
    if (figures(source) !== figures(value)) fail(where, `figures differ from the English (${figures(source)})`);
    if (ending(source) !== ending(value)) fail(where, `ends with ${ending(value)}, the English with ${ending(source)}`);
  }
}
for (const [key, wording] of Object.entries(FIXED)) {
  if (english[key] !== wording) fail(`[en] ${key}`, 'the fixed wording has changed');
}

// Every text file of the site, and of the export when there is one.
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const isText = (file) => /\.(?:html|js|mjs|ts|tsx|css|txt|xml|svg)$/.test(file);

const sourceFiles = ['app', 'components', 'lib', 'scripts', 'public']
  .flatMap((dir) => walk(path.join(WEB, dir)))
  .concat(path.join(REPO, 'packages/brand-tokens/src/index.ts'))
  .filter(isText);
const exported = existsSync(OUT) ? walk(OUT).filter(isText) : [];

for (const file of [...sourceFiles, ...exported]) {
  const text = readFileSync(file, 'utf8');
  const where = path.relative(REPO, file);
  for (const pattern of SPELLED_OUT) {
    const hit = text.match(pattern);
    if (hit) fail(where, `the acronym is spelled out: “${hit[0]}”`);
  }
  for (const [what, pattern] of RETIRED) {
    const hit = text.match(pattern);
    if (hit) fail(where, `${what}: “${hit[0]}”`);
  }
}

// The exported pages.
const strip = (html) =>
  html
    .replace(/<script\b.*?<\/script>/gs, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const pages = exported.filter((file) => file.endsWith('.html'));
for (const file of pages) {
  const html = readFileSync(file, 'utf8');
  const where = '/' + path.relative(OUT, file).replace(/index\.html$/, '');
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
  const h1 = levels.filter((level) => level === 1).length;
  if (h1 !== 1) fail(where, `${h1} h1 elements`);
  levels.reduce((previous, level) => {
    if (level > previous + 1) fail(where, `a heading jumps from h${previous} to h${level}`);
    return level;
  }, 0);
  if (where.includes('404')) continue;

  const required = {
    'a header': /<header\b/,
    'the main landmark': /<main\b[^>]*id="main"/,
    'a footer': /<footer\b/,
    'a skip link': /<a\b[^>]*href="#main"/,
    'a description': /<meta name="description" content="[^"]{50,}"/,
    'a canonical address': /<link rel="canonical" href="https:\/\/[^"]+\/"/,
    'a share image served as a PNG': /<meta property="og:image" content="[^"]+\.png"/,
  };
  for (const [what, pattern] of Object.entries(required)) {
    if (!pattern.test(html)) fail(where, `missing ${what}`);
  }
  for (const image of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt="[^"]+"/.test(image[0])) fail(where, 'an image has no alt text');
  }
  if (/target="_blank"/.test(html)) fail(where, 'a link opens a new tab without saying so');
}

if (pages.length) {
  const home = strip(readFileSync(path.join(OUT, 'index.html'), 'utf8'));
  const workflows = strip(readFileSync(path.join(OUT, 'features/index.html'), 'utf8'));
  const options = [
    'Find Relevant Grant Opportunities',
    'Assess Our Funding Alignment',
    'Explore Funder Priorities',
    'Ethical Strengths-Based Proposal Guide',
  ];
  const order = options.map((option) => home.indexOf(option));
  if (order.includes(-1) || order.some((at, index) => index > 0 && at < order[index - 1])) {
    fail('/', 'the four options are missing or out of order');
  }
  for (const [where, text] of [['/', home], ['/features/', workflows]]) {
    for (const wording of [FIXED['hub.description'], 'Organization Knowledge Hub']) {
      if (!text.includes(wording)) fail(where, `missing “${wording}”`);
    }
  }
  if (!home.includes(FIXED['ask.h2'])) fail('/', `missing “${FIXED['ask.h2']}”`);
  if (!workflows.includes(FIXED['privacy.5'])) fail('/features/', `missing “${FIXED['privacy.5']}”`);
}

console.log(
  Object.entries(dictionaries)
    .map(([locale, dictionary]) => `${locale} ${Object.keys(dictionary).length}`)
    .join(', ') + ' keys',
);
console.log(`${sourceFiles.length} source files checked.`);
console.log(
  pages.length ? `${exported.length} exported files and ${pages.length} pages checked.` : 'No export found; build the site to check the pages too.',
);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('The copy keeps every rule.');
