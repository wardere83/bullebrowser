// Prices are product decisions, not Stripe price IDs. IDs are server config.
export const PLANS = Object.freeze({
  free: { monthlyCents: 0, searches: 10, period: 'day' },
  individual: { monthlyCents: 1599, searches: 500, period: 'month' },
  pro_plus: { monthlyCents: 2099, searches: 1000, period: 'month' },
  pro_max: { monthlyCents: 3099, searches: 1800, period: 'month' },
});

export function paidPlan(name) {
  if (!Object.hasOwn(PLANS, name) || name === 'free') throw new Error('Invalid paid plan');
  return PLANS[name];
}

// Integer microdollars prevent rounding errors in a future AI credit ledger.
// Rates are microdollars per token (numerically USD per million tokens).
export function modelReservation({ inputBytes, maxOutputTokens, inputRate, outputRate }) {
  for (const n of [inputBytes, maxOutputTokens, inputRate, outputRate]) {
    if (!Number.isFinite(n) || n < 0) throw new Error('Invalid cost inputs');
  }
  if (!Number.isSafeInteger(inputBytes) || !Number.isSafeInteger(maxOutputTokens)) throw new Error('Invalid token bounds');
  // Conservative text-only bound: at most one token per UTF-8 input byte,
  // plus request overhead. Image/audio requests require a separate estimator.
  const reserve = Math.ceil((inputBytes + 4096) * inputRate + maxOutputTokens * outputRate);
  if (!Number.isSafeInteger(reserve)) throw new Error('Cost exceeds safe integer range');
  return reserve;
}
