import { ArrowRight } from 'lucide-react';
import { Card } from '../../../components/ui';
import { StatusChip } from './common';

/** Overview: documents verified, blocking items with their status, days in this stage, missing answers. Uses the shell (no extra load). */
export default function OverviewTab({ app, onGo }) {
  const s = app.documents_summary;
  const pct = s.required ? Math.round((s.verified / s.required) * 100) : 100;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-slate-500">Required items verified</p><p className="mt-1 text-2xl font-semibold text-navy-900">{s.verified} <span className="text-base font-normal text-slate-500">of {s.required}</span></p>
          <div className="mt-2 h-1.5 rounded-full bg-slate-100" aria-hidden><div className="h-1.5 rounded-full bg-brand" style={{ width: `${pct}%` }} /></div></Card>
        <Card className="p-4"><p className="text-xs text-slate-500">Days in this stage</p><p className="mt-1 text-2xl font-semibold text-navy-900">{app.days_in_stage ?? '–'}</p><p className="text-xs text-slate-500">{app.status}</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-500">Missing answers</p><p className="mt-1 text-2xl font-semibold text-navy-900">{app.missing_answers.length}</p>
          {app.missing_answers.length > 0 && <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => onGo('applicant')}>See them in Applicant</button>}</Card>
      </div>
      <Card className="p-4">
        <h3 className="font-semibold text-navy-900">Category and relationship</h3>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2"><dt className="text-slate-500">Category</dt><dd className="text-navy-900">{app.category}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-500">Relationship to the child</dt><dd className="text-navy-900">{app.relationship}</dd></div>
        </dl>
      </Card>
      <Card className="p-4">
        <h3 className="font-semibold text-navy-900">Blocking items</h3>
        {s.blocking.length === 0 ? <p className="mt-1 text-sm text-emerald-700">Nothing is blocking. Every required document and check is verified.</p> : (
          <ul className="mt-2 divide-y divide-slate-100">
            {s.blocking.map((b) => (
              <li key={b.doc_type} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 text-navy-900">{b.label}</span>
                <span className="flex items-center gap-2"><StatusChip status={b.status} />
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline" onClick={() => onGo(b.tab || 'documents', b.tab === 'idcheck' ? undefined : 'blocking')}>
                    Open <ArrowRight className="h-3 w-3" aria-hidden /><span className="sr-only">{b.label}</span></button></span>
              </li>
            ))}
          </ul>
        )}
        {app.gate && app.gate.blockers.some((b) => !b.status) && (
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">{app.gate.blockers.filter((b) => !b.status).map((b) => <li key={b.message}>{b.message}</li>)}</ul>
        )}
      </Card>
    </div>
  );
}
