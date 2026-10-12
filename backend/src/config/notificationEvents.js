/**
 * Notifications: categories per role and every event type, in one place. Edit wording here.
 *
 * Privacy (RA 10173): titles and texts may contain only a reference or case number, an event and a
 * status. Never names of applicants or children, health, adoption, financial or case details,
 * internal notes, token IDs or file contents. Links contain only IDs.
 *
 * Each event: category, priority (action | warning | info), title(p), body(p), link(p), and
 * critical: true when the user can't turn it off.
 */

/** Categories per role (chips and preferences). Admin "Action required" and "Warnings" filter by priority. */
const CATEGORIES = {
  Admin: [
    { key: 'action_required', label: 'Action required', priority: 'action' },
    { key: 'warnings', label: 'Warnings', priority: 'warning' },
    { key: 'applications', label: 'Applications' },
    { key: 'donations', label: 'Donations and payments' },
    { key: 'inventory', label: 'Inventory' },
    { key: 'children', label: 'Children and records' },
    { key: 'staff_accounts', label: 'Staff and accounts' },
    { key: 'security', label: 'Security' },
  ],
  Staff: [
    { key: 'assignments', label: 'Assignments' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'applications', label: 'Applications' },
    { key: 'donations', label: 'Donations' },
    { key: 'inventory', label: 'Inventory' },
  ],
  Donor: [
    { key: 'applications', label: 'Applications' },
    { key: 'donations', label: 'Donations' },
    { key: 'account', label: 'Account' },
  ],
};

/** Real categories a notification can be stored with, per role (the priority chips are virtual). */
const storedCategories = (role) => (CATEGORIES[role] || []).filter((c) => !c.priority).map((c) => c.key);

const app = (p) => `/applications/${p.id}`;          // donor's own application
const staffApp = (p) => `/adoptions/${p.id}`;        // Admin / Staff application page
const review = (p) => `/transition-reviews/${p.id}`;

const EVENTS = {
  // ---------------- Transition Review (18+): case number and event only
  ...(() => {
    const ev = {
      transition_conference: [(p) => `Case ${p.ref}: case conference scheduled`, (p) => `Conference on ${p.date}.`],
      transition_decision: [(p) => `Case ${p.ref}: transition decision recorded`, (p) => `Decision: ${p.decision}.`],
      transition_placement: [(p) => `Case ${p.ref}: transition recorded`, () => 'Aftercare follow-ups are scheduled.'],
      transition_ready_close: [(p) => `Case ${p.ref}: ready for closure`, () => 'Aftercare is complete. The review can be closed.'],
      transition_assessment_overdue: [(p) => `Case ${p.ref}: transition assessment overdue`, () => 'The assessment has not started yet.'],
      transition_date_soon: [(p) => `Case ${p.ref}: transition date approaching`, (p) => `Target transition date: ${p.date}.`],
      transition_plan_incomplete: [(p) => `Case ${p.ref}: transition plan incomplete`, (p) => `Tasks are still open; target date ${p.date}.`],
      transition_task_due: [(p) => `Case ${p.ref}: transition task due soon`, (p) => `A task is due on ${p.due}.`],
      aftercare_due: [(p) => `Case ${p.ref}: aftercare follow-up due`, (p) => `${p.round} follow-up on ${p.date}.`],
      aftercare_overdue: [(p) => `Case ${p.ref}: aftercare follow-up overdue`, (p) => `The ${p.round} follow-up is overdue.`],
    };
    const warn = ['transition_assessment_overdue', 'transition_plan_incomplete', 'aftercare_overdue'];
    const out = {};
    for (const [k, [title, body]] of Object.entries(ev)) {
      out[`admin_${k}`] = { category: 'children', priority: warn.includes(k) ? 'warning' : k === 'transition_ready_close' ? 'action' : 'info', title, body, link: review };
      out[`staff_${k}`] = { category: 'assignments', title, body, link: review };
    }
    return out;
  })(),

  // ---------------- Donor: applications
  application_submitted: { category: 'applications', title: (p) => `Application ${p.ref}: submitted`, body: () => 'We received your application. You can follow its progress here.', link: app },
  application_under_review: { category: 'applications', title: (p) => `Application ${p.ref}: under review`, body: () => 'The home has started reviewing your application.', link: app },
  documents_requested: { category: 'applications', priority: 'action', critical: true, title: (p) => `Application ${p.ref}: documents requested`, body: () => 'Open the application to upload them.', link: app },
  application_remark: { category: 'applications', title: (p) => `Application ${p.ref}: a message from the home`, body: () => 'Open the application to read it.', link: app },
  interview_scheduled: { category: 'applications', title: (p) => `Application ${p.ref}: home visit or interview scheduled`, body: () => 'Open the application for the details.', link: app },
  application_approved: { category: 'applications', critical: true, title: (p) => `Application ${p.ref}: approved`, body: () => 'The home approved your application. Open it to see the next steps.', link: app },
  application_declined: { category: 'applications', critical: true, title: (p) => `Application ${p.ref}: declined`, body: () => 'Open the application to read the home\'s message.', link: app },
  application_withdrawn: { category: 'applications', title: (p) => `Application ${p.ref}: withdrawn`, body: () => 'Your application was withdrawn.', link: app },
  application_match_review: { category: 'applications', title: (p) => `Application ${p.ref}: a possible match is being reviewed`, body: () => 'The home will contact you about the next steps.', link: app },
  application_status: { category: 'applications', title: (p) => `Application ${p.ref}: ${p.status}`, body: (p) => `Your application is now at: ${p.status}.`, link: app },

  // ---------------- Donor: donations
  donation_paid: { category: 'donations', title: () => 'Donation received. Thank you!', body: () => 'Your payment was received and your receipt is ready.', link: () => '/donations/history' },
  transfer_submitted: { category: 'donations', title: () => 'Bank transfer submitted', body: () => 'It is waiting for verification by the staff.', link: () => '/donations/history' },
  transfer_confirmed: { category: 'donations', title: () => 'Bank transfer confirmed', body: () => 'Your donation was confirmed and your receipt is ready.', link: () => '/donations/history' },
  transfer_rejected: { category: 'donations', title: () => 'Bank transfer not confirmed', body: (p) => `Reason: ${p.reason}`, link: () => '/donations/history' },
  payment_failed: { category: 'donations', title: (p) => `Online payment ${p.status}`, body: () => 'No money was taken and no donation was recorded.', link: () => '/donations/history' },
  receipt_issued: { category: 'donations', title: () => 'Receipt issued', body: () => 'Your donation receipt is ready in Donation history.', link: () => '/donations/history' },

  // ---------------- Donor: account
  password_changed: { category: 'account', critical: true, title: () => 'Your password was changed', body: () => 'If this wasn\'t you, contact the home right away.', link: () => '/notifications' },
  account_reactivated: { category: 'account', title: () => 'Your account was reactivated', body: () => 'You can sign in again.', link: () => '/notifications' },
  duties_changed: { category: 'assignments', title: () => 'Your duties were updated', body: (p) => `You can now work in: ${p.duties}.`, link: () => '/' },
  account_deactivated: { category: 'account', critical: true, title: () => 'Your account was deactivated', body: () => 'Contact the home if you have questions.', link: () => '/notifications' },

  // ---------------- Admin
  admin_application_submitted: { category: 'applications', priority: 'action', title: (p) => `Application ${p.ref}: submitted`, body: () => 'A new application needs review and an assigned staff member.', link: staffApp },
  admin_documents_uploaded: { category: 'applications', priority: 'action', title: (p) => `Application ${p.ref}: documents uploaded`, body: () => 'The applicant uploaded requested documents.', link: staffApp },
  admin_stage_update: { category: 'applications', priority: 'info', title: (p) => `Application ${p.ref}: ${p.stage}`, body: (p) => p.what || 'Open the case for details.', link: staffApp },
  admin_match_update: { category: 'applications', priority: 'action', title: (p) => `Application ${p.ref}: match ${p.step}`, body: (p) => (p.step === 'under review' ? 'Approve or withdraw the proposed match.' : p.step === 'approved' ? "Record NACC's referral or confirmation." : 'Open Matching and placement for details.'), link: staffApp },
  admin_decision_needed: { category: 'applications', priority: 'action', title: (p) => `Application ${p.ref}: decision needed`, body: () => 'The home study is complete. Clear for matching or decline.', link: staffApp },
  admin_application_withdrawn: { category: 'applications', priority: 'info', title: (p) => `Application ${p.ref}: withdrawn by the applicant`, body: () => 'No action is needed.', link: staffApp },
  admin_transfer_pending: { category: 'donations', priority: 'action', title: (p) => (p.count > 1 ? `${p.count} bank transfers to verify` : 'A bank transfer is waiting for verification'), body: () => 'Proof was uploaded. Confirm or reject it on the Donations page.', link: () => '/donations' },
  admin_void_requested: { category: 'donations', priority: 'action', title: (p) => `Donation ${p.ref}: void requested`, body: () => 'A staff member asked to void this donation. Approve or decline it on the donation page.', link: (p) => `/donations/${p.id}` },
  admin_donation_received: { category: 'donations', priority: 'info', title: (p) => (p.count > 1 ? `${p.count} donations received` : 'A donation was received'), body: (p) => `Latest: ${p.source}.`, link: () => '/donations' },
  admin_payment_failed: { category: 'donations', priority: 'warning', title: (p) => (p.count > 1 ? `${p.count} online payments failed` : 'An online payment failed'), body: () => 'No donation was recorded.', link: () => '/donations' },
  admin_webhook_error: { category: 'donations', priority: 'warning', title: (p) => (p.count > 1 ? `${p.count} payment webhook errors` : 'A payment webhook error occurred'), body: () => 'Check the PayMongo webhook settings and the server log.', link: () => '/donations' },
  admin_low_stock: { category: 'inventory', priority: 'warning', title: (p) => `${p.count} item${p.count === 1 ? ' is' : 's are'} low on stock`, body: () => 'Open Inventory to restock.', link: () => '/inventory' },
  admin_child_turned_18: { category: 'children', priority: 'action', title: (p) => (p.count > 1 ? `${p.count} children added to Transition Review` : `Case ${p.ref}: added to Transition Review`), body: () => 'Assign staff and start the review.', link: () => '/transitions' },
  admin_unassigned: { category: 'children', priority: 'action', title: (p) => `${p.count} record${p.count === 1 ? '' : 's'} without an active assigned staff member`, body: () => 'An assigned staff account was deactivated. Assign someone else.', link: (p) => p.where || '/adoptions' },
  admin_account_changed: { category: 'staff_accounts', priority: 'info', title: (p) => `A ${p.role} account was ${p.change}`, body: (p) => `User #${p.id}.`, link: () => '/users' },
  // Overlapping shifts are already refused when saving, so this reports changes made by another Admin.
  admin_shift_conflict: { category: 'staff_accounts', priority: 'info', title: (p) => `Schedule changed: ${p.date}`, body: () => 'Another administrator changed or removed a shift.', link: () => '/schedules' },
  admin_lockout: { category: 'security', priority: 'warning', critical: true, title: () => 'A staff member was locked out', body: () => 'Repeated wrong Token IDs. Check the Sensitive record access log.', link: () => '/audit-log?category=sensitive' },
  admin_unlock_started: { category: 'security', priority: 'info', critical: true, title: (p) => `${p.unusual ? 'Unusual unlock' : 'Unlock started'}: ${p.ref}`, body: (p) => (p.unusual ? `Flagged: ${p.why}.` : 'A staff member opened a sensitive record.'), link: () => '/audit-log?category=sensitive' },
  admin_session_revoked: { category: 'security', priority: 'info', critical: true, title: (p) => `Access session ended: ${p.ref}`, body: (p) => `Ended by ${p.by}.`, link: () => '/audit-log?category=sensitive' },

  // ---------------- Staff
  assigned: { category: 'assignments', title: (p) => `Assigned to you: ${p.ref}`, body: () => 'You can now unlock this record.', link: (p) => (p.kind === 'transition_review' ? review(p) : p.kind === 'child' ? `/children/${encodeURIComponent(p.id)}` : staffApp(p)) },
  unassigned: { category: 'assignments', title: (p) => `Unassigned: ${p.ref}`, body: () => 'You are no longer assigned to this record.', link: () => '/notifications' },
  staff_access_ended: { category: 'assignments', title: (p) => `Access ended: ${p.ref}`, body: () => 'Access ended by an administrator.', link: () => '/notifications' },
  staff_stage_update: { category: 'applications', title: (p) => `Application ${p.ref}: ${p.stage}`, body: (p) => p.what || 'Open the case for details.', link: staffApp },
  staff_match_update: { category: 'applications', title: (p) => `Application ${p.ref}: match ${p.step}`, body: () => 'Open Matching and placement for details.', link: staffApp },
  staff_documents_uploaded: { category: 'applications', title: (p) => `Application ${p.ref}: documents uploaded`, body: () => 'The applicant uploaded requested documents.', link: staffApp },
  staff_transfer_pending: { category: 'donations', title: (p) => (p.count > 1 ? `${p.count} bank transfers to verify` : 'A bank transfer is waiting for verification'), body: () => 'Confirm or reject it on the Donations page.', link: () => '/donations' },
  staff_low_stock: { category: 'inventory', title: (p) => `${p.count} item${p.count === 1 ? ' is' : 's are'} low on stock`, body: () => 'Open Inventory to restock.', link: () => '/inventory' },
  shift_created: { category: 'schedule', title: (p) => `New shift: ${p.date}`, body: (p) => `${p.time}, ${p.area}.`, link: () => '/my-schedule' },
  shift_changed: { category: 'schedule', title: (p) => `Shift changed: ${p.date}`, body: (p) => `${p.time}, ${p.area}.`, link: () => '/my-schedule' },
  shift_removed: { category: 'schedule', title: (p) => `Shift removed: ${p.date}`, body: (p) => `${p.time}, ${p.area}.`, link: () => '/my-schedule' },
};

/**
 * When an unlock is "unusual" (Warning instead of Info): outside 7:00 to 19:00, or the same staff
 * member's 4th or later unlock today.
 */
const UNUSUAL_UNLOCK = { startHour: 7, endHour: 19, maxPerDay: 3 };

/** Icons used by the frontend, per category. */
const ICONS = {
  action_required: 'alert', warnings: 'warning', applications: 'file', donations: 'gift', inventory: 'box', children: 'child',
  staff_accounts: 'users', security: 'shield', assignments: 'user-check', schedule: 'calendar', account: 'user',
};

module.exports = { CATEGORIES, EVENTS, ICONS, UNUSUAL_UNLOCK, storedCategories };
