import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeedbackBar, FeedbackThumbs } from './FeedbackBar.js';
import { StrategyPlaybook } from './StrategyPlaybook.js';

const playbook = { headline: 'Apply for the workforce grant', winThemes: [], actions: [] } as never;

describe('feedback buttons', () => {
  it('offers thumbs up and down, marking the one already given', () => {
    const html = renderToStaticMarkup(<FeedbackThumbs rating="down" what="response" onChoose={() => {}} />);
    expect(html).toContain('aria-label="Good response"');
    expect(html).toMatch(/aria-pressed="false"[^>]*aria-label="Good response"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Bad response"[^>]*text-primary/);
    expect(renderToStaticMarkup(<FeedbackBar feedbackKey="c:1" kind="reply" excerpt="Hello" />)).toContain('aria-label="Rate this response"');
  });

  it('asks about a finished playbook, not one still being written', () => {
    expect(renderToStaticMarkup(<StrategyPlaybook playbook={playbook} feedbackKey="strategy:r1" />)).toContain('Was this playbook useful?');
    expect(renderToStaticMarkup(<StrategyPlaybook playbook={playbook} live feedbackKey="strategy:r1" />)).not.toContain('Was this playbook useful?');
    expect(renderToStaticMarkup(<StrategyPlaybook playbook={playbook} />)).not.toContain('Was this playbook useful?');
  });
});
