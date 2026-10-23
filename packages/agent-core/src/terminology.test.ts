import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TERMINOLOGY_INSTRUCTIONS, applyTerminology } from './terminology.js';

// The long form is put together here, a word at a time, so that it is written
// nowhere in this package. `long()` is the usual spelling; options vary it.
// Cases are named rather than printed, so it stays out of test reports too.
const FIRST = 'community';
const SECOND = 'based';
const THIRD = 'organization';

function long({ join: hyphen = '-', plural = true, third = THIRD, gap = ' ' } = {}): string {
  return `${FIRST}${hyphen}${SECOND}${gap}${third}${plural ? 's' : ''}`;
}

function titled(text: string): string {
  return text.replace(/(^|[\s-])(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}

const MANY = long();
const ONE = long({ plural: false });
// Any spelling of the long form, for checking that none is left behind.
const SPELLED_OUT = new RegExp(`${FIRST}[\\s\\p{Pd}]*${SECOND}\\s*organi[sz]ation`, 'iu');

// Characters that pass for a hyphen or a space without being the usual one.
const UNICODE_HYPHEN = String.fromCodePoint(0x2010);
const NON_BREAKING_HYPHEN = String.fromCodePoint(0x2011);
const EN_DASH = String.fromCodePoint(0x2013);
const MINUS_SIGN = String.fromCodePoint(0x2212);
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);

describe('applyTerminology', () => {
  it.each([
    ['the plural', `We fund ${MANY}.`, 'We fund CBOs.'],
    ['the singular', `A ${ONE} may apply.`, 'A CBO may apply.'],
    ['the plural without a hyphen', `${long({ join: ' ' })} are eligible`, 'CBOs are eligible'],
    ['the singular without a hyphen', `one ${long({ join: ' ', plural: false })} per county`, 'one CBO per county'],
    ['title case', titled(MANY), 'CBOs'],
    ['capitals', MANY.toUpperCase(), 'CBOs'],
    ['a capital at the start of a sentence', `${titled(FIRST)}-${SECOND} ${THIRD}`, 'CBO'],
    ['the British spelling', long({ third: 'organisation' }), 'CBOs'],
    ['a non-breaking hyphen', long({ join: NON_BREAKING_HYPHEN }), 'CBOs'],
    ['an en dash', long({ join: EN_DASH }), 'CBOs'],
    ['a spaced hyphen', long({ join: ' - ' }), 'CBOs'],
    ['a no-break space', long({ gap: NO_BREAK_SPACE }), 'CBOs'],
    ['a phrase wrapped after the second word', `grants for ${long({ gap: '\n' })} only`, 'grants for CBOs only'],
    ['a phrase wrapped at the hyphen', `grants for ${FIRST}-\n${SECOND} ${THIRD}s only`, 'grants for CBOs only'],
    ['the long form followed by the acronym', `${MANY} (CBOs) may apply`, 'CBOs may apply'],
    ['the same in title case', `${titled(MANY)} (CBOs)`, 'CBOs'],
    ['the same in the singular', `a ${ONE} (CBO)`, 'a CBO'],
    ['the acronym in straight quotes', `${MANY} ("CBOs")`, 'CBOs'],
    ['the acronym in curly quotes', `${MANY} (“CBOs”)`, 'CBOs'],
    ['the acronym in bold', `${MANY} (**CBOs**)`, 'CBOs'],
    ['the acronym after "or"', `${MANY} (or CBOs)`, 'CBOs'],
    ['the acronym after "also known as"', `${MANY} (also known as CBOs)`, 'CBOs'],
    ['the acronym "for short"', `${MANY} (CBOs for short)`, 'CBOs'],
    ['the acronym in square brackets', `${MANY} [CBOs]`, 'CBOs'],
    // The long form carries the sentence, so its number wins.
    ['a plural long form with a singular acronym', `${MANY} (CBO) are eligible`, 'CBOs are eligible'],
    ['the acronym followed by the long form', `CBOs (${MANY}) may apply`, 'CBOs may apply'],
    ['the acronym followed by the singular long form', `a CBO (${ONE})`, 'a CBO'],
    ['the acronym "short for" the long form', `CBOs (short for ${MANY})`, 'CBOs'],
    ['the acronym, "i.e." the long form', `CBOs (i.e., ${titled(MANY)})`, 'CBOs'],
    ['a lower-case acronym explained', `cbos (${MANY})`, 'CBOs'],
    ['the acronym named between commas', `${MANY}, or CBOs, are eligible`, 'CBOs are eligible'],
    ['the acronym named at the end of a sentence', `${MANY}, also known as CBOs.`, 'CBOs.'],
    ['a comma that belongs to the sentence', `${MANY} or CBOs, which serve a neighbourhood`, 'CBOs, which serve a neighbourhood'],
    ['a possessive after the named acronym', `${MANY} or CBOs' fiscal sponsors`, "CBOs' fiscal sponsors"],
    ['a singular possessive', `${ONE}'s board`, "CBO's board"],
    ['a plural possessive', `${MANY}' boards`, "CBOs' boards"],
    ['a compound', `a ${ONE}-led coalition`, 'a CBO-led coalition'],
    ['the audience', `businesses and ${MANY}`, 'businesses and CBOs'],
    ['bold text', `**${titled(MANY)}**`, '**CBOs**'],
    ['the text of a link', `[${titled(MANY)}](https://example.org/who-we-fund)`, '[CBOs](https://example.org/who-we-fund)'],
    [
      'a heading and the paragraph under it',
      `## Support for ${titled(MANY)}\n\n${titled(MANY)} (CBOs) may apply. Each ${ONE} needs a UEI.`,
      '## Support for CBOs\n\nCBOs may apply. Each CBO needs a UEI.',
    ],
  ])('rewrites %s', (_case, input, expected) => {
    expect(applyTerminology(input)).toBe(expected);
  });

  it.each([
    ['an empty string', ''],
    ['the plural acronym', 'CBOs and businesses may both apply.'],
    ['the singular acronym', 'Each CBO needs a fiscal sponsor.'],
    ['a longer word after the first two', `${FIRST}-${SECOND} ${THIRD}al capacity`],
    ['another word after the first two', `${FIRST}-${SECOND} organizing`],
    ['a different third word', `${FIRST}-${SECOND} care`],
    ['a different second word', `${FIRST} development ${THIRD}s`],
    ['a different first word', `faith-${SECOND} ${THIRD}s`],
    ['a longer first word', `inter${FIRST}-${SECOND} ${THIRD}s`],
    ['two list items', `- ${FIRST}-${SECOND}\n- ${THIRD}s`],
    ['two paragraphs', `${FIRST}-${SECOND}\n\n${THIRD}s`],
  ])('leaves %s alone', (_case, text) => {
    expect(applyTerminology(text)).toBe(text);
  });

  it('keeps a bracket that says something of its own', () => {
    expect(applyTerminology(`${MANY} (especially small CBOs) may apply`)).toBe('CBOs (especially small CBOs) may apply');
    expect(applyTerminology(`CBOs (unlike larger ${MANY}) may apply`)).toBe('CBOs (unlike larger CBOs) may apply');
  });

  it.each([
    // In the first three the phrase would begin inside the address, so
    // rewriting it would break the link.
    ['a URL that ends where the phrase would start', `See https://example.org/${FIRST}-${SECOND} ${THIRD}s for the list.`],
    ['the same without a scheme', `See www.example.org/${FIRST}-${SECOND} ${THIRD}s for the list.`],
    ['an e-mail address', `Write to info@example.${FIRST}-${SECOND} ${THIRD}s welcome.`],
    ['a URL path', `https://example.org/${FIRST}-${SECOND}-${THIRD}s`],
    ['a URL query', `https://example.org/search?q=${FIRST}+${SECOND}+${THIRD}s`],
    ['inline code', `\`${MANY}\``],
    ['inline code inside a sentence', `Search for \`"${MANY}"\` exactly.`],
    ['a fenced block', `\`\`\`\nquery = "${MANY}"\n\`\`\``],
    ['a fenced block that is still open', `\`\`\`json\n{ "applicant": "${ONE}" }`],
  ])('leaves %s exactly as written', (_case, text) => {
    expect(applyTerminology(text)).toBe(text);
  });

  it('still rewrites the prose around protected text', () => {
    expect(
      applyTerminology(`${titled(MANY)}: see https://example.org/${FIRST}-${SECOND}-${THIRD}s and \`${MANY}\` (${MANY}).`),
    ).toBe(`CBOs: see https://example.org/${FIRST}-${SECOND}-${THIRD}s and \`${MANY}\` (CBOs).`);
    expect(applyTerminology(`Mail ${ONE}@example.org about ${MANY}.`)).toBe(`Mail ${ONE}@example.org about CBOs.`);
  });

  it.each([
    ['a sentence with three forms', `We fund ${MANY} (CBOs) and each ${ONE}.`],
    ['nested brackets', `${MANY} (${MANY} (CBOs))`],
    ['every pairing at once', `CBOs (${MANY}) and ${MANY}, or CBOs,`],
    ['the long form twice in a row', `${MANY} ${MANY}`],
    ['code beside prose', `\`${MANY}\` and ${MANY}`],
    ['backticks around a wrapped phrase', `\`x ${long({ gap: '\n' })} y \`${MANY}\` z\``],
    ['a fence, prose and a stray backtick', `\`\`\`\n${MANY}\n\`\`\`\n${MANY}\n\`${long({ gap: '\n' })}`],
  ])('changes nothing more when applied twice to %s', (_case, text) => {
    const once = applyTerminology(text);
    expect(applyTerminology(once)).toBe(once);
  });

  // Joining the wrapped phrase changes which backticks pair up as code, so one
  // pass over this text leaves the second phrase for the next.
  it('settles text that a single pass would leave half done', () => {
    expect(applyTerminology(`\`x ${long({ gap: '\n' })} y \`${MANY}\` z\``)).toBe('`x CBOs y `CBOs` z`');
  });

  it('leaves no long form in prose, however it is spelled', () => {
    const hyphens = ['-', ' ', UNICODE_HYPHEN, NON_BREAKING_HYPHEN, EN_DASH, MINUS_SIGN, ' - '];
    const gaps = [' ', '  ', '\t', NO_BREAK_SPACE, '\n', ' \n  '];
    for (const hyphen of hyphens) {
      for (const gap of gaps) {
        for (const third of [THIRD, 'organisation']) {
          for (const plural of [true, false]) {
            for (const shape of [(text: string) => text, titled, (text: string) => text.toUpperCase()]) {
              const phrase = shape(long({ join: hyphen, gap, third, plural }));
              const out = applyTerminology(`Funding for ${phrase}, today.`);
              expect(out).toBe(`Funding for ${plural ? 'CBOs' : 'CBO'}, today.`);
            }
          }
        }
      }
    }
  });

  // An address is looked for only at the start of a run of its characters;
  // looking from every position made a long hash take seconds.
  it('stays quick on a long token that only looks like the start of an address', () => {
    const started = Date.now();
    expect(applyTerminology(`${'a1b2c3d4'.repeat(25_000)}@`)).toHaveLength(200_001);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe('TERMINOLOGY_INSTRUCTIONS', () => {
  it('asks for the acronym, singular and plural, and names the audience', () => {
    expect(TERMINOLOGY_INSTRUCTIONS).toContain('"CBOs"');
    expect(TERMINOLOGY_INSTRUCTIONS).toContain('"CBO"');
    expect(TERMINOLOGY_INSTRUCTIONS).toContain('"businesses and CBOs"');
    expect(TERMINOLOGY_INSTRUCTIONS).toMatch(/never write out/);
  });

  it('does not itself contain the long form', () => {
    expect(TERMINOLOGY_INSTRUCTIONS).not.toMatch(SPELLED_OUT);
    expect(applyTerminology(TERMINOLOGY_INSTRUCTIONS)).toBe(TERMINOLOGY_INSTRUCTIONS);
  });
});

describe('the package source', () => {
  // Prompts, canned replies, comments and tests are all product text. A search
  // of this package for the long form must find nothing.
  it('never spells the acronym out', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((file) => SPELLED_OUT.test(readFileSync(join(root, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
