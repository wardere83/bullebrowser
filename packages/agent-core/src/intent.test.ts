import { describe, expect, it } from 'vitest';
import { requestIntent } from './intent.js';

describe('requestIntent', () => {
  it('treats conversation as chat', () => {
    for (const text of ['hi', 'Hello!', 'hey there', 'Good morning', 'thanks', 'Thank you so much!!!!!!!!', 'ok', 'perfect',
      'You rock', 'how are you?', 'What can you do?', 'How can you help me?', 'help', 'bye', '']) {
      expect(requestIntent(text), text).toBe('chat');
    }
  });

  it('treats questions as questions', () => {
    for (const text of ['What is a 501(c)(3)?', 'How do I write a strong mission statement?', 'Why does a budget narrative matter?',
      'explain the difference between a nonprofit and a charity', 'Should I hire a consultant', 'Write me a short thank-you note to a donor']) {
      expect(requestIntent(text), text).toBe('question');
    }
  });

  it('treats work in the browser as browsing', () => {
    for (const text of ['Find youth grants in New Jersey', 'Search for workforce funding in California', 'Open grants.gov',
      'go to https://www.njeda.gov', 'Can you look up the deadline on njeda.gov?', 'Summarize this page', 'What does this page say?',
      'Compare these two funders', 'What grants are available for food banks?', 'click "Apply"', 'Please check the current deadline']) {
      expect(requestIntent(text), text).toBe('browse');
    }
  });

  it('always browses for a chosen browser task', () => {
    expect(requestIntent('hi', { browserTask: 'find_grants' })).toBe('browse');
  });
});
