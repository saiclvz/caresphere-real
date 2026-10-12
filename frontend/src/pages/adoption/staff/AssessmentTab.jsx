import { CalendarClock } from 'lucide-react';
import { formatDate, formatDateTime } from '../../../lib/format';
import { Card } from '../../../components/ui';
import { StatusChip, TabState, useTab } from './common';

const fileStatus = (files) => (files.length ? (files[files.length - 1].verification_status || 'Uploaded') : 'Pending submission');

/** Assessment: interviews and home study, the forum certificate, the case study, the social worker. */
export default function AssessmentTab({ app, version, onGo }) {
  const state = useTab(app.application_id, 'assessment', version);
  return (
    <TabState state={state} rows={6}>
      {(d) => (
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-2 font-semibold text-navy-900">Interviews and home study</h3>
            {d.interviews.length === 0 ? <p className="text-sm text-slate-500">None scheduled. Schedule the home study through Update status.</p> : (
              <ul className="space-y-2">
                {d.interviews.map((i) => (
                  <li key={i.interview_id} className="flex gap-2 text-sm"><CalendarClock className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                    <span><span className="font-medium text-navy-900">{i.kind}</span>, {formatDateTime(i.scheduled_at)}{i.details && <span className="block text-slate-500">{i.details}</span>}<span className="block text-xs text-slate-400">Scheduled by {i.created_by_name}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="divide-y divide-slate-100 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
              <span><span className="font-medium text-navy-900">Adoption forum certificate</span>{d.forum_certificate.verified_at && <span className="block text-xs text-slate-500">Forum attended recorded {formatDate(d.forum_certificate.verified_at)}</span>}</span>
              <span className="flex items-center gap-2"><StatusChip status={fileStatus(d.forum_certificate.files)} /><button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => onGo('documents')}>Open in Documents</button></span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <span><span className="font-medium text-navy-900">Social Case Study Report</span>{d.case_study.completed_at && <span className="block text-xs text-slate-500">Case study completed {formatDate(d.case_study.completed_at)}</span>}</span>
              <span className="flex items-center gap-2"><StatusChip status={fileStatus(d.case_study.files)} /><button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => onGo('documents')}>Open in Documents</button></span>
            </div>
          </Card>
          <Card className="p-4 text-sm">
            <h3 className="font-semibold text-navy-900">Social worker</h3>
            <p className="mt-1 text-navy-900">{d.social_worker?.name || 'Not assigned'}</p>
            <p className="text-xs text-slate-500">The assigned staff member writes the home study report after the visit. There is nothing for the applicant to upload for it.</p>
          </Card>
        </div>
      )}
    </TabState>
  );
}
