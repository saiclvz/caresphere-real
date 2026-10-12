import VerificationList from '../../../components/adoption/VerificationList';
import { EmptyState } from '../../../components/ui';
import { TabState, useTab } from './common';

/**
 * ID check: the front and back photos, the automated checks, the official verification result, and
 * Verify, Request correction and Reject. "Verified – real and valid" only with an official result; a
 * person's verification shows as "Manually verified by [role] on [date]". Clearance checks follow.
 */
export default function IdCheckTab({ app, config, version, onChanged }) {
  const state = useTab(app.application_id, 'idcheck', version);
  return (
    <TabState state={state} rows={6}>
      {(d) => (d.verifications.length === 0
        ? <EmptyState title="No ID or clearance checks yet" description="They are created when the application is submitted." />
        : <VerificationList app={{ application_id: app.application_id, status: app.status, verifications: d.verifications, form: d.form }} config={config} mode="staff"
            onUpdated={app.archived_at ? null : () => onChanged()} />)}
    </TabState>
  );
}
