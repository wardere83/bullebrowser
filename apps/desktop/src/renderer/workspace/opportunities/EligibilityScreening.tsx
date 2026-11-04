import { useId, useState } from 'react';
import { APPLICANT_TYPE_LABELS, type ApplicantType, type Opportunity } from '../../../shared/funding.js';
import { screenEligibility } from '../../../shared/opportunity-eligibility.js';
import { ExternalLink, text } from '../ui/index.js';

export function EligibilityScreening({ opportunity }: { opportunity: Opportunity }) {
  const id = useId();
  const [applicantType, setApplicantType] = useState<ApplicantType | null>(null);
  const [amount, setAmount] = useState('');
  const checks = screenEligibility(opportunity, { applicantType, requestedAmount: amount.trim() ? Number(amount) : null, currency: opportunity.currency });
  const labels = { compatible: 'Matches this criterion', conflict: 'Possible conflict', unknown: 'Needs review' };
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <h3 id={`${id}-title`} className={text.overline}>Eligibility screening</h3>
      <p className={text.small}>Confirm these facts for this listing. Checks use the source’s stated criteria, separately from keyword relevance. They do not establish full eligibility. Entries stay in this view and are not sent to a model.</p>
      <label htmlFor={`${id}-type`} className={text.small}>Your confirmed legal applicant category</label>
      <select id={`${id}-type`} value={applicantType ?? ''} onChange={event => setApplicantType(event.target.value as ApplicantType || null)} className="rounded border border-line bg-white p-2 text-sm text-ink-primary">
        <option value="">Not confirmed</option>
        {Object.entries(APPLICANT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{value === 'nonprofit' ? 'Legally recognized nonprofit' : label}</option>)}
      </select>
      <label htmlFor={`${id}-amount`} className={text.small}>Amount you intend to request ({opportunity.currency || 'currency not stated'})</label>
      <input id={`${id}-amount`} type="number" min="0" step="any" value={amount} onChange={event => setAmount(event.target.value)} className="rounded border border-line bg-white p-2 text-sm text-ink-primary" />
      <ul className="flex flex-col gap-2" aria-live="polite">
        {checks.map(check => <li key={check.criterion} className={text.small}><strong>{check.criterion}: {labels[check.status]}</strong><p>{check.reason}</p></li>)}
      </ul>
      <ExternalLink href={opportunity.officialUrl}>Review the official eligibility requirements</ExternalLink>
    </section>
  );
}
