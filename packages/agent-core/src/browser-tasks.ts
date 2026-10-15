export type BrowserTaskId = 'find_grants' | 'research_funder' | 'compare_grants' | 'explore_page';

export const BROWSER_TASKS = [
  { id: 'find_grants', label: 'Find grants for me', icon: 'search', question: 'Where are you based, and what needs funding?', instruction: 'Find open grants matching the user’s location and funding need. Search official sources, open viable programs in visible browser tabs, and check eligibility, amounts and deadlines.' },
  { id: 'research_funder', label: 'Research a funder', icon: 'compass', question: 'Which funder should I research?', instruction: 'Research the named funder on its official website. Open its current programs, priorities, eligibility and application requirements in visible browser tabs.' },
  { id: 'compare_grants', label: 'Compare grant opportunities', icon: 'scale', question: 'Which grants, or what funding goal, should I compare?', instruction: 'Compare the named grants, or discover grants for the funding goal. Open each viable official program in a visible browser tab and verify eligibility, amount, deadlines and application requirements.' },
  { id: 'explore_page', label: 'Explore this page', icon: 'external', question: 'What should I look for on this page?', instruction: 'Start with the current browser page, or a website URL supplied by the user. Read it and follow relevant links in visible browser tabs to accomplish their goal.' },
] as const;

export function browserTask(id: BrowserTaskId | undefined) {
  return BROWSER_TASKS.find((task) => task.id === id);
}
