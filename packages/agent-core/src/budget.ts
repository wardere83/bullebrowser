// The step budget.
//
// The old flat cap of 25 calls treated a list_tabs like a navigate: simple
// tasks burned it on cheap look-ups and complex ones hit the wall mid-flow.
// Calls now cost by weight, the user can raise the budget per task, and the
// model is warned at 75% so it can wrap up instead of being cut off.

export const DEFAULT_STEP_BUDGET = 40;
export const MAX_STEP_BUDGET = 200;
export const BUDGET_WARN_AT = 0.75;

const CHEAP = new Set([
  'getPageMetadata',
  'getActiveTab',
  'list_tabs',
  'listTabs',
  'switch_tab',
  'getSelection',
  'clipboard_read',
  'list_files',
]);
const EXPENSIVE = new Set([
  'navigate',
  'new_tab',
  'screenshot',
  'extract',
  'extractStructuredData',
  'ocr_page',
  'replay',
]);

export function stepCost(toolName: string): number {
  if (CHEAP.has(toolName)) return 0.5;
  if (EXPENSIVE.has(toolName)) return 2;
  return 1;
}

export interface BudgetCharge {
  /** False when this call would exceed the budget; it must not run. */
  ok: boolean;
  /** True on the call that first crosses the warning threshold. */
  warn: boolean;
  used: number;
  total: number;
}

export class StepBudget {
  private spent = 0;
  private warned = false;
  readonly total: number;

  constructor(total = DEFAULT_STEP_BUDGET) {
    this.total = Math.max(1, Math.min(MAX_STEP_BUDGET, Math.round(total)));
  }

  get used(): number {
    return this.spent;
  }

  charge(toolName: string): BudgetCharge {
    const cost = stepCost(toolName);
    if (this.spent + cost > this.total + 1e-9) {
      return { ok: false, warn: false, used: this.spent, total: this.total };
    }
    this.spent += cost;
    let warn = false;
    if (!this.warned && this.spent >= this.total * BUDGET_WARN_AT) {
      this.warned = true;
      warn = true;
    }
    return { ok: true, warn, used: this.spent, total: this.total };
  }

  warningNote(): string {
    return (
      `[budget] ${fmt(this.spent)} of ${this.total} steps used (75%). Wrap up: finish the ` +
      'essential steps and give your answer soon. The user can raise the budget if more is needed.'
    );
  }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
