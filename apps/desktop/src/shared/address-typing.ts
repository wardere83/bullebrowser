// The agent types where it is going into the address bar before the page
// loads, the way a person would, instead of the page simply changing.

/** What a person types for a URL: no scheme, no trailing slash. */
export function addressText(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/** Long enough to follow, short enough not to slow the task: 35 ms a character, 0.35 to 1.2 s. */
export function typingDuration(text: string): number {
  return Math.min(1200, Math.max(350, text.length * 35));
}
