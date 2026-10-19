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
    { key: 'donations', label: 'Donations' },
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
  application_declined: { category: 'applications', critical: true, title: (p) => `Application ${p.ref}: rejected`, body: () => 'Open the application to read the home\'s message.', link: app },
  application_withdrawn: { category: 'applications', title: (p) => `Application ${p.ref}: withdrawn`, body: () => 'Your application was withdrawn.', link: app },
  application_match_review: { category: 'applications', title: (p) => `Application ${p.ref}: a possible match is being reviewed`, body: () => 'The home will contact you about the next steps.', link: app },
  application_status: { category: 'applications', title: (p) => `Application ${p.ref}: ${p.status}`, body: (p) => `Your application is now at: ${p.status}.`, link: app },

  // ---------------- Donor: donations
  // QR donations: the donor reports a transfer they made outside CareSphere; the home confirms it. Reference only.
  donation_reported: { category: 'donations', title: (p) => `Donation ${p.ref}: reported`, body: () => 'It shows as "Waiting for the home to confirm" until the home checks its account.', link: () => '/donations/history' },
  donation_confirmed: { category: 'donations', title: (p) => `Donation ${p.ref}: confirmed by the home`, body: () => 'Thank you. Your acknowledgment follows once the home records how it will be used.', link: () => '/donations/history' },
  donation_not_matched: { category: 'donations', critical: true, title: (p) => `Donation ${p.ref}: not matched yet`, body: () => 'Open Donation history to read the message from the home.', link: () => '/donations/history' },
  donation_details_requested: { category: 'donations', priority: 'action', critical: true, title: (p) => `Donation ${p.ref}: the home needs more details`, body: () => 'Open Donation history to read the message and reply.', link: () => '/donations/history' },
  donation_withdrawn: { category: 'donations', title: (p) => `Donation ${p.ref}: withdrawn`, body: () => 'You can report it again with the correct details.', link: () => '/donations/history' },
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
  admin_claims_to_verify: { category: 'donations', priority: 'action', title: (p) => (p.count > 1 ? `${p.count} donor reports to verify` : 'A donor report is waiting to be verified'), body: () => "Check the home's account, then verify it in Donations > To verify.", link: () => '/donations?view=verify' },
  admin_claim_approval: { category: 'donations', priority: 'action', title: (p) => `Donation ${p.ref}: approval needed`, body: (p) => (p.kind === 'amount_difference' ? 'The amount received differs from the amount reported.' : 'A second person must confirm this verification.'), link: (p) => `/donations/${p.id}` },
  admin_claims_stale: { category: 'donations', priority: 'warning', title: (p) => `${p.count} donor report${p.count === 1 ? ' is' : 's are'} stale`, body: (p) => `Waiting more than ${p.days} days. They are never verified or removed automatically.`, link: () => '/donations?view=verify&queue=stale' },
  admin_claim_burst: { category: 'security', priority: 'warning', critical: true, title: () => 'Many donation reports in a short time', body: (p) => `${p.count} reports in 10 minutes. Check the To verify queue for misuse.`, link: () => '/donations?view=verify' },
  admin_qr_change: { category: 'security', priority: 'action', critical: true, title: (p) => `Payment QR ${p.label}: change ${p.step}`, body: (p) => (p.step === 'requested' ? 'Another Admin must review and approve it in Settings > Payment QR.' : String(p.step).startsWith('applied') ? 'Donors now see this change. Check that it was expected.' : 'No change was made.'), link: () => '/settings?section=payments' },
  admin_qr_problem: { category: 'security', priority: 'action', critical: true, title: (p) => `Payment QR ${p.label}: problem reported by a donor`, body: () => 'Check the QR and the account details in Settings > Payment QR.', link: () => '/settings?section=payments' },
  admin_donation_alert: { category: 'donations', priority: 'warning', title: (p) => `Donation ${p.ref}: ${p.what}`, body: () => 'Open the donation to review it.', link: (p) => `/donations/${p.id}` },
  admin_donation_controls_changed: { category: 'security', priority: 'warning', critical: true, title: () => 'Donation controls changed', body: (p) => `Changed: ${p.keys}. Check that this was expected.`, link: () => '/settings?section=payments' },
  admin_cash_confirm: { category: 'donations', priority: 'action', title: (p) => `Donation ${p.ref}: cash to confirm`, body: () => 'Above the dual-control amount: a second person confirms it was received.', link: (p) => `/donations/${p.id}` },
  admin_cash_count: { category: 'donations', priority: 'action', title: (p) => `Cash count for ${p.date}: sign-off needed`, body: (p) => (p.difference ? `Difference: ${p.difference}.` : 'The count matches the recorded cash.'), link: () => '/donations?view=cash' },
  admin_void_requested: { category: 'donations', priority: 'action', title: (p) => `Donation ${p.ref}: void requested`, body: () => 'A staff member asked to void this donation. Approve or decline it on the donation page.', link: (p) => `/donations/${p.id}` },
  admin_donation_received: { category: 'donations', priority: 'info', title: (p) => (p.count > 1 ? `${p.count} donations received` : 'A donation was received'), body: (p) => `Latest: ${p.source}.`, link: () => '/donations' },
  admin_low_stock: { category: 'inventory', priority: 'warning', title: (p) => `${p.count} item${p.count === 1 ? ' is' : 's are'} low on stock`, body: () => 'Open Inventory to restock.', link: () => '/inventory' },
  admin_child_turned_18: { category: 'children', priority: 'action', title: (p) => (p.count > 1 ? `${p.count} children added to Transition Review` : `Case ${p.ref}: added to Transition Review`), body: () => 'Assign staff and start the review.', link: () => '/transitions' },
  // Child record access (case numbers only, never names or details).
  admin_needs_reassignment: { category: 'children', priority: 'action', title: (p) => `${p.count} record${p.count === 1 ? '' : 's'} need reassignment`, body: (p) => p.why || 'Assign someone else.', link: () => '/children?assigned=attention' },
  admin_children_unassigned: { category: 'children', priority: 'action', title: (p) => `${p.count} child record${p.count === 1 ? '' : 's'} without an assigned case worker`, body: () => 'Assign a case worker on the Children page.', link: () => '/children?assigned=unassigned' },
  admin_child_no_case_worker: { category: 'children', priority: 'action', title: (p) => `Child ${p.ref}: no case worker after the initial window`, body: () => "The registering staff member's temporary access ended. Assign a case worker.", link: (p) => `/children/${encodeURIComponent(p.id)}?tab=access` },
  admin_cover_ending: { category: 'children', priority: 'warning', title: (p) => `${p.kind === 'child' ? 'Child' : p.kind === 'transition_review' ? 'Transition review' : 'Application'} ${p.ref}: temporary cover ends soon`, body: (p) => `Ends ${p.when}.`, link: (p) => (p.kind === 'child' ? `/children/${encodeURIComponent(p.id)}?tab=access` : p.kind === 'transition_review' ? `/transition-reviews/${p.id}` : `/adoptions/${p.id}`) },
  admin_access_requested: { category: 'children', priority: 'action', title: (p) => `Child ${p.ref}: access requested`, body: () => 'A staff member asked for access. Assign, grant a temporary cover, or deny.', link: (p) => `/children/${encodeURIComponent(p.id)}?tab=access` },
  admin_emergency_access: { category: 'security', priority: 'warning', critical: true, title: (p) => `Emergency access: child ${p.ref}`, body: (p) => `Reason: ${p.reason}. Review it in Emergency access to review.`, link: () => '/children?panel=emergency' },
  admin_emergency_limit: { category: 'security', priority: 'warning', critical: true, title: () => 'Emergency access limit exceeded', body: (p) => `A staff member tried to use emergency access more than ${p.limit} times today.`, link: () => '/audit-log?category=sensitive' },
  admin_admission_submitted: { category: 'children', priority: 'action', title: (p) => `New admission ${p.ref} waiting for review`, body: () => 'Open Admissions for Review on the Children page to approve, return or decline it.', link: (p) => `/admissions/${encodeURIComponent(p.id)}` },
  admin_privacy_concern: { category: 'security', priority: 'action', critical: true, title: () => 'A privacy concern was reported', body: () => 'Open Data protection to read it.', link: () => '/data-protection?tab=concerns' },
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
  case_worker_access_requested: { category: 'assignments', title: (p) => `Child ${p.ref}: access requested`, body: () => 'A staff member asked for access to a record you are assigned to. An Admin decides.', link: (p) => `/children/${encodeURIComponent(p.id)}` },
  case_worker_emergency_access: { category: 'assignments', title: (p) => `Emergency access opened: ${p.ref}`, body: () => 'A staff member opened the Care card in an emergency. An Admin will review it.', link: (p) => `/children/${encodeURIComponent(p.id)}` },
  access_request_decided: { category: 'assignments', title: (p) => `Child ${p.ref}: access request ${p.approved ? 'approved' : 'not approved'}`, body: (p) => (p.approved ? 'You can open the record now.' : 'Ask the Admin if you have questions.'), link: (p) => `/children/${encodeURIComponent(p.id)}` },
  care_card_review_due: { category: 'assignments', title: (p) => `Child ${p.ref}: Care card review due`, body: () => 'Check the Care card and mark it reviewed.', link: (p) => `/children/${encodeURIComponent(p.id)}` },
  admission_approved: { category: 'assignments', title: (p) => `Admission ${p.ref} approved`, body: (p) => (p.assigned ? 'The child is admitted and you are the assigned case worker.' : 'The child is admitted. Your admission access has ended; an Admin assigns the case worker.'), link: (p) => (p.assigned ? `/children/${encodeURIComponent(p.id)}` : '/children/intake') },
  admission_returned: { category: 'assignments', title: (p) => `Admission ${p.ref} returned for correction`, body: () => 'Open it, make the corrections and submit it again.', link: (p) => `/admissions/${encodeURIComponent(p.id)}` },
  admission_declined: { category: 'assignments', title: (p) => `Admission ${p.ref} declined`, body: () => 'The reason is shown on the Intake page.', link: () => '/children/intake?status=closed' },
  staff_access_ended: { category: 'assignments', title: (p) => `Access ended: ${p.ref}`, body: () => 'Access ended by an administrator.', link: () => '/notifications' },
  staff_stage_update: { category: 'applications', title: (p) => `Application ${p.ref}: ${p.stage}`, body: (p) => p.what || 'Open the case for details.', link: staffApp },
  staff_match_update: { category: 'applications', title: (p) => `Application ${p.ref}: match ${p.step}`, body: () => 'Open Matching and placement for details.', link: staffApp },
  staff_documents_uploaded: { category: 'applications', title: (p) => `Application ${p.ref}: documents uploaded`, body: () => 'The applicant uploaded requested documents.', link: staffApp },
  staff_claims_to_verify: { category: 'donations', title: (p) => (p.count > 1 ? `${p.count} donor reports to verify` : 'A donor report is waiting to be verified'), body: () => "Check the home's account, then verify it in Donations > To verify.", link: () => '/donations?view=verify' },
  staff_claim_approval: { category: 'donations', title: (p) => `Donation ${p.ref}: second verifier needed`, body: () => 'Confirm the verification if the details match the home account.', link: (p) => `/donations/${p.id}` },
  staff_cash_confirm: { category: 'donations', title: (p) => `Donation ${p.ref}: cash to confirm`, body: () => 'A second person confirms cash above the dual-control amount.', link: (p) => `/donations/${p.id}` },
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
