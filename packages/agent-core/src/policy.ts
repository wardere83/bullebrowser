import type { PlanStep, PolicyDecision, TargetFacts } from './types.js';

// Blocking a typing action outright is a hard stop with no user override, so
// this has to be precise. The old pattern was bare substrings: `card` blocked
// "Search cards" on any kanban board and `social` blocked "Social handle",
// while still not actually detecting a password field. Anchor the terms that
// are only ever credentials or payment data.
const SENSITIVE_FIELD_RE =
  /(password|passcode|\bcvv\b|\bcvc\b|\bssn\b|social security|credit[ -]?card|card ?number|security code|\bpin\b|\bapi[ -]?key\b|\bsecret\b)/i;

// Redaction only affects what's echoed into the step feed, so it stays broad:
// over-redacting a log line costs nothing, under-redacting leaks. This is the
// original blanket pattern, kept as-is deliberately — only the *blocking*
// decision above needed to become precise.
const REDACT_KEY_RE = /(password|passcode|token|secret|ssn|social|credit|card|cvv)/i;

export const HIGH_RISK_TARGET_RE = /(submit|purchase|buy|pay|delete|remove|send|upload|publish)/i;

export interface PolicyEngine {
  evaluateToolStep(step: PlanStep): PolicyDecision;
  allowExternalProvider(context: { url?: string; text?: string }): PolicyDecision;
  redact(value: unknown): unknown;
}

export class PrivacyPolicyEngine implements PolicyEngine {
  evaluateToolStep(step: PlanStep): PolicyDecision {
    if (step.toolName === 'typeIntoField' || step.toolName === 'type') {
      const target = String(step.input.target ?? '');
      if (SENSITIVE_FIELD_RE.test(target)) {
        return {
          allowed: false,
          reason: 'Typing into sensitive credential or payment fields is blocked by policy.',
          requiresConfirmation: false,
        };
      }
      // Typing text is not itself consequential — it's the submit/purchase
      // click that is, and that's gated below. Prompting here meant typing a
      // search query raised a modal, which trains people to click through the
      // prompts that actually matter.
      return { allowed: true, requiresConfirmation: false };
    }

    // _facts is what the runtime found on the page for this action (see
    // inspectTarget): the element's real label and whether it submits a form
    // carrying the user's data. Judge that, not only the model's wording.
    const facts = step.input._facts as TargetFacts | undefined;

    if (step.toolName === 'clickElement' || step.toolName === 'click') {
      const target = String(step.input.target ?? '');
      return {
        allowed: true,
        requiresConfirmation:
          HIGH_RISK_TARGET_RE.test(target) ||
          HIGH_RISK_TARGET_RE.test(facts?.label ?? '') ||
          facts?.submitsForm === true,
      };
    }

    // Enter in a sign-up, checkout or message form submits it just as the
    // button would, and Enter or Space on a focused button presses it. A lone
    // search box does not count (submitsForm is false).
    if (step.toolName === 'press_key' && (step.input.key === 'Enter' || step.input.key === 'Space')) {
      return {
        allowed: true,
        requiresConfirmation:
          facts?.submitsForm === true ||
          (facts?.activates === true && HIGH_RISK_TARGET_RE.test(facts.label)),
      };
    }

    if (step.toolName === 'close_tab') {
      return { allowed: true, requiresConfirmation: true };
    }

    return { allowed: true, requiresConfirmation: false };
  }

  allowExternalProvider(context: { url?: string; text?: string }): PolicyDecision {
    const url = context.url ?? '';
    const text = context.text ?? '';
    if (/mail|messages|bank|wallet|account|checkout/i.test(url)) {
      return {
        allowed: false,
        reason: 'External provider disabled for sensitive account or messaging pages.',
        requiresConfirmation: false,
      };
    }
    if (text.length > 25_000) {
      return {
        allowed: false,
        reason: 'External provider blocked for oversized page content; use local summarization.',
        requiresConfirmation: false,
      };
    }
    return { allowed: true, requiresConfirmation: false };
  }

  redact(value: unknown): unknown {
    if (typeof value === 'string') {
      return value
        .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_API_KEY]')
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED_TOKEN]');
    }
    if (Array.isArray(value)) return value.map((v) => this.redact(v));
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEY_RE.test(k) ? '[REDACTED]' : this.redact(v);
    }
    return out;
  }
}
