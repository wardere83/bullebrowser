import type { PlanStep, PolicyDecision } from './types.js';

const SENSITIVE_FIELD_RE = /(apiKey|api_key|password|passcode|token|secret|ssn|social|credit|card|cvv)/i;
const HIGH_RISK_TARGET_RE = /(submit|purchase|buy|pay|delete|remove|send|upload|publish)/i;

export interface PolicyEngine {
  evaluateToolStep(step: PlanStep): PolicyDecision;
  allowExternalProvider(context: { url?: string; text?: string }): PolicyDecision;
  redact(value: unknown): unknown;
}

export class PrivacyPolicyEngine implements PolicyEngine {
  evaluateToolStep(step: PlanStep): PolicyDecision {
    if (step.toolName === 'queryDom') {
      return {
        allowed: false,
        reason: 'queryDom is not yet wired in this runtime. Use page text tools instead.',
        requiresConfirmation: false,
      };
    }

    if (step.toolName === 'typeIntoField' || step.toolName === 'type') {
      const target = String(step.input.target ?? '');
      if (SENSITIVE_FIELD_RE.test(target)) {
        return {
          allowed: false,
          reason: 'Typing into sensitive credential or payment fields is blocked by policy.',
          requiresConfirmation: false,
        };
      }
      return { allowed: true, requiresConfirmation: true };
    }

    if (step.toolName === 'clickElement' || step.toolName === 'click') {
      const target = String(step.input.target ?? '');
      return {
        allowed: true,
        requiresConfirmation: HIGH_RISK_TARGET_RE.test(target),
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
      out[k] = SENSITIVE_FIELD_RE.test(k) ? '[REDACTED]' : this.redact(v);
    }
    return out;
  }
}
