import type { PlanStep, PolicyDecision } from './types.js';

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

    if (step.toolName === 'clickElement' || step.toolName === 'click') {
      return {
        allowed: true,
        // A selector says nothing about the action behind it. Until the
        // runtime has a trusted semantic classifier, confirm every click.
        requiresConfirmation: true,
      };
    }

    if (step.toolName === 'press_key' && step.input.key === 'Enter') {
      return { allowed: true, requiresConfirmation: true };
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
