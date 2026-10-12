import { Lock } from 'lucide-react';
import { formatDateTime } from '../../../lib/format';
import { Card } from '../../../components/ui';
import { displayValue, fieldStatus, pageFields } from '../formLogic';
import { StatusChip, TabState, useTab } from './common';

/** The answer groups (the application's pages 1 to 8). */
const GROUPS = { 1: 'Applicant information', 2: 'Family and household', 3: 'Identity', 4: 'Background', 5: 'Financial', 6: 'Health', 7: 'References', 8: 'Reason for adoption' };
const LEGACY_LABELS = {
  address: 'Address', occupation: 'Occupation', employment_details: 'Employment details', spouse_details: 'Spouse / co-applicant details',
  household_members: 'Household members', living_conditions: 'Living conditions', caregiving_experience: 'Caregiving experience',
};
const LEGACY_PAGE = { 1: ['address', 'occupation', 'employment_details'], 2: ['spouse_details', 'household_members', 'living_conditions', 'caregiving_experience'] };

/** Applicant tab: every answer grouped 1 to 8, what is missing (with jump links), and the consent record. */
export default function ApplicantTab({ app, config, version }) {
  const state = useTab(app.application_id, 'applicant', version);
  return (
    <TabState state={state} rows={10}>
      {(d) => {
        const missing = d.missing_answers;
        const byPage = missing.reduce((m, x) => ({ ...m, [x.page]: (m[x.page] || 0) + 1 }), {});
        return (
          <div className="space-y-4">
            <div className={`rounded-lg border p-3 text-sm ${missing.length ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`} role="status">
              <p className="font-medium">{missing.length ? `${missing.length} answer${missing.length === 1 ? '' : 's'} missing` : 'Every required answer is filled in.'}</p>
              {missing.length > 0 && (
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{Object.entries(byPage).map(([p, n]) => (
                  <a key={p} href={`#ap-${p}`} className="underline underline-offset-2" onClick={(e) => { e.preventDefault(); document.getElementById(`ap-${p}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); document.getElementById(`ap-${p}`)?.focus(); }}>
                    {p}. {GROUPS[p]} ({n})
                  </a>
                ))}</p>
              )}
            </div>
            {config.pages.filter((p) => p.n <= 8).map((p) => {
              const fields = pageFields(config, p.n, d.form);
              const legacy = d.legacy ? (LEGACY_PAGE[p.n] || []).filter((k) => d.legacy[k]) : [];
              return (
                <Card key={p.n} className="p-4">
                  <h3 id={`ap-${p.n}`} tabIndex={-1} className="mb-2 scroll-mt-24 font-semibold text-navy-900 focus:outline-none">{p.n}. {GROUPS[p.n] || p.title}</h3>
                  {legacy.length > 0 && (
                    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500"><Lock className="h-3.5 w-3.5" aria-hidden /> From the earlier application form (read-only)</p>
                      <dl className="space-y-1 text-sm">{legacy.map((k) => <div key={k}><dt className="text-slate-500">{LEGACY_LABELS[k]}</dt><dd className="whitespace-pre-line text-navy-900">{d.legacy[k]}</dd></div>)}</dl>
                    </div>
                  )}
                  {fields.length === 0 ? <p className="text-sm text-slate-500">No questions on this page apply to this application.</p> : (
                    <dl className="divide-y divide-slate-100">
                      {fields.map(([key, def]) => {
                        const value = displayValue(config, key, def, d.form);
                        const status = d.is_legacy && !value ? 'Optional' : fieldStatus(config, key, def, d.form);
                        return (
                          <div key={key} className="flex flex-wrap items-start justify-between gap-2 py-2">
                            <dt className="min-w-0 flex-1 text-sm"><span className="text-slate-500">{def.label}</span>
                              <span className="block whitespace-pre-line break-words text-navy-900">{value || <span className="text-slate-400">Not answered</span>}</span></dt>
                            <dd><StatusChip status={status} /></dd>
                          </div>
                        );
                      })}
                    </dl>
                  )}
                  {p.n === 3 && <p className="mt-2 text-xs text-slate-500">The ID photos and their checks are in the ID check tab. Every uploaded file is in the Documents tab.</p>}
                </Card>
              );
            })}
            <Card className="p-4 text-sm">
              <h3 className="mb-1 font-semibold text-navy-900">Consent and privacy notice</h3>
              {d.consent.consented_at
                ? <p className="text-slate-700">Consent {d.consent.consent_version || ''} and privacy notice {d.consent.privacy_notice_version || ''} recorded {formatDateTime(d.consent.consented_at)}.</p>
                : <p className="text-slate-500">No consent recorded (earlier form).</p>}
            </Card>
          </div>
        );
      }}
    </TabState>
  );
}
