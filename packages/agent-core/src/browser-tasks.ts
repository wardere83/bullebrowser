export type BrowserTaskId = 'find_grants' | 'research_funder' | 'compare_grants' | 'explore_page';

export const BROWSER_TASKS = [
  { id: 'find_grants', label: 'Find grants for me', icon: 'search', question: 'Where are you based, and what needs funding?', instruction: 'Find open grants matching the user’s location and funding need: business grants and nonprofit grants alike, unless the user names one kind. Search official sources, then browse each viable program on its official site as a person would, clicking through in the visible browser, and check eligibility, amounts and deadlines.' },
  { id: 'research_funder', label: 'Research a funder', icon: 'compass', question: 'Which funder should I research?', instruction: 'Research the named funder on its official website. Browse it as a person would, clicking through its own menus to its current programs, priorities, eligibility and application requirements.' },
  { id: 'compare_grants', label: 'Compare grant opportunities', icon: 'scale', question: 'Which grants, or what funding goal, should I compare?', instruction: 'Compare the named grants, or discover business and nonprofit grants for the funding goal. Visit each viable official program in the visible browser, clicking through from the funder’s site where you can, and verify eligibility, amount, deadlines and application requirements.' },
  { id: 'explore_page', label: 'Explore this page', icon: 'external', question: 'What should I look for on this page?', instruction: 'Start with the current browser page, or a website URL supplied by the user. Read it and click through its relevant links in the visible browser to accomplish their goal.' },
] as const;

export function browserTask(id: BrowserTaskId | undefined) {
  return BROWSER_TASKS.find((task) => task.id === id);
}
