// What every workspace screen must do, checked for each screen in routes.ts by
// rendering it to static markup the way it first appears: before any data has
// arrived, with no window and no bridge.
//
// A screen that fails here is not following the screen contract:
//  - it returns a <Screen> at once, so there is exactly one h1 from the first
//    render (loading, empty and error states go inside it);
//  - its headings go in order, without skipping a level;
//  - it does not touch `window` or the bridge while rendering (calls belong in
//    useAsync, effects and event handlers);
//  - it renders nothing reserved for the assistant panel.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../routes.js';
import { Onboarding } from './Onboarding.js';

const SCREENS = [
  ...ROUTES.map((definition) => ({ name: definition.label, Component: definition.component })),
  { name: 'Onboarding', Component: Onboarding },
];

const headingLevels = (html: string) =>
  [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));

describe.each(SCREENS)('the $name screen', ({ Component }) => {
  const html = renderToStaticMarkup(<Component />);

  it('renders exactly one h1 from its first render', () => {
    expect(headingLevels(html).filter((level) => level === 1)).toHaveLength(1);
  });

  it('starts with its h1 and never skips a heading level', () => {
    const levels = headingLevels(html);
    expect(levels[0]).toBe(1);
    levels.forEach((level, index) => {
      const previous = levels[index - 1] ?? 1;
      expect(level - previous, `h${level} after h${previous}`).toBeLessThanOrEqual(1);
    });
  });

  it('renders nothing reserved for the assistant panel', () => {
    expect(html).not.toMatch(/<aside[\s>]/);
    expect(html).not.toContain('role="complementary"');
    expect(html).not.toContain('md-prose');
    expect(html).not.toContain('chat-user-message');
  });

  it('gives every button a type, so none submits a form by accident', () => {
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    for (const button of buttons) expect(button).toMatch(/\stype="(button|submit)"/);
  });
});
