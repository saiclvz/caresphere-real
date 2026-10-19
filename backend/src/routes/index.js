const express = require('express');
const h = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { requireDuty, requireAnyDuty, requireDutyForUnlock } = require('../middleware/requireDuty');
// Staff duties per area (Admin and Donors pass). See config/staffDuties.js.
const D_CHILDREN = requireDuty('children');
const D_ADMISSION = requireDuty('admission');
const D_CHILD_OR_ADMISSION = requireAnyDuty('children', 'admission');
const D_HEALTH = requireDuty('health');
const D_ADOPTION = requireDuty('adoption');
const D_TRANSITION = requireDuty('transition');
const D_DONATIONS = requireDuty('donations');
const D_VISITORS = requireDuty('visitors');
const D_INVENTORY = requireDuty('inventory');
const D_MEALS = requireDuty('meals');
const { requireHealthAccess } = require('../services/healthAccessService');

const auth = require('../controllers/authController');
const children = require('../controllers/childController');
const admissions = require('../controllers/admissionController');
const adoptions = require('../controllers/adoptionController');
const transitions = require('../controllers/transitionController');
const inventory = require('../controllers/inventoryController');
const donations = require('../controllers/donationController');
const donor = require('../controllers/donorController');
const donorRecords = require('../controllers/donorRecordController');
const visitors = require('../controllers/visitorController');
const meals = require('../controllers/mealController');
const idTypes = require('../controllers/idTypeController');
const schedules = require('../controllers/scheduleController');
const users = require('../controllers/userController');
const settings = require('../controllers/settingsController');
const audit = require('../controllers/auditController');
const dashboard = require('../controllers/dashboardController');
const compliance = require('../controllers/complianceController');
const notifications = require('../controllers/notificationController');
const unlock = require('../controllers/unlockController');
const claimsCtl = require('../controllers/donationClaimController');
const { limits: claimLimits } = require('../services/claimSettings');
const protectedRecords = require('../controllers/protectedRecordController');
const adoptionDetail = require('../controllers/adoptionDetailController');
const stages = require('../controllers/adoptionStageController');
const archivedDocs = require('../controllers/archivedDocumentController');
const matching = require('../controllers/matchingController');
const childLegal = require('../controllers/childLegalController');
const childAccess = require('../controllers/childAccessController');
const { monitoringGuard } = require('../services/childAccess');

const router = express.Router();
const ADMIN = authorize('Admin');
/** Logs a non-Admin attempt at an admission decision (the ADMIN guard after it refuses with 403). */
const ADMISSION_DECISION = (verb) => async (req, res, next) => {
  if (req.user && req.user.role !== 'Admin') {
    await require('../utils/audit').logDenied(req, `ADMISSION_${verb.toUpperCase()}_DENIED (not Admin)`, `Child ${String(req.params.id).slice(0, 50)}`,
      `${req.user.full_name || `User #${req.user.user_id}`} (${req.user.role}) attempted to ${verb === 'verify' ? 'verify a document of' : verb} an admission. Only an Admin may do this.`);
  }
  next();
};
const OPS = authorize('Admin', 'Staff');
// Donor accounts include the adoption-applicant features (Adopt a Child, My applications).
const DONOR = authorize('Donor');
const ANY = authorize('Admin', 'Staff', 'Donor');
const REVIEWERS = authorize('Admin', 'Staff', 'Donor'); // Donors: own applications only (checked in controller)

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
// Capture-attempt reports: generous, but a stuck key or a script can't flood the logs.
const captureLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: 'Too many reports.' });
const tokenLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: 'Too many verification attempts. Wait a minute and try again.' });
const mfaLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 15, message: 'Too many verification attempts. Wait 5 minutes and try again.' });
const verifyLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Too many receipt checks. Wait a minute and try again.' });
// Receipt checks from everyone together (a distributed guess attempt still hits this).
const verifyGlobalLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, key: 'global', message: 'Receipt checking is busy. Wait a minute and try again.' });
const reauthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: 'user', message: 'Too many attempts. Wait 15 minutes and try again.' });
// Donation reports per network address per hour (Settings: donation_claim_ip_hourly_limit); per-donor limits are in the service.
const claimIpLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: async () => (await claimLimits()).donation_claim_ip_hourly_limit, message: 'Too many donation reports from this network. Please try again later.' });
const claimUserLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, key: 'user', message: 'Please wait a minute before trying again.' });
const fileLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, key: 'user', message: 'Too many file requests. Wait a minute.' });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'Too many uploads. Wait a minute and try again.' });
// ID scan: the page asks for results every few seconds while a photo is scanned; PhilSys Check results are recorded by hand.
const idScanLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'Too many requests. Wait a minute and try again.' });
const philsysLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Too many attempts. Wait a minute and try again.' });

// ---------- Health check ----------
router.get('/health', (req, res) => res.json({ success: true, service: 'caresphere-api', time: new Date().toISOString() }));

// ---------- Auth ----------
router.post('/auth/login', loginLimiter, h(auth.login));
router.post('/auth/register', loginLimiter, h(auth.register));
router.post('/auth/logout', authenticate, h(auth.logout));
router.get('/auth/me', authenticate, h(auth.me));
router.put('/auth/password', authenticate, h(auth.changePassword));
// Two-step verification (Admin). These take the short-lived mfa_token, not a session.
router.post('/auth/mfa/setup/start', mfaLimiter, h(auth.mfaSetupStart));
router.post('/auth/mfa/setup/confirm', mfaLimiter, h(auth.mfaSetupConfirm));
router.post('/auth/mfa/verify', mfaLimiter, h(auth.mfaVerify));

// Public (signed out): the home's contact details for the footer, Privacy Policy and Terms pages.
router.get('/public/contact', h(settings.publicContact));

// Everything below requires a valid session.
router.use(authenticate);
// Admin monitoring visits (NACC, DSWD): read-only, selected child records only, no downloads (services/childAccess.js).
router.use(monitoringGuard);

// ---------- Typed tokens (60 s) for health access ----------

// ---------- Dashboard ----------
router.get('/dashboard/summary', OPS, h(dashboard.summary));
router.get('/dashboard/due-soon', OPS, D_ADOPTION, h(dashboard.dueSoon)); // adoption deadlines

// ---------- Children ----------
router.get('/children/rules', ANY, h(children.rules));
router.get('/children', OPS, D_CHILDREN, h(children.list));
// New children come only through the admission workflow (Admission duty); POST /children starts an admission (Step 1).
router.post('/children', OPS, uploadLimiter, D_ADMISSION, h(admissions.create));
// ---------- Admissions (services/admission.js -> the child record policy) ----------
router.get('/admissions', OPS, D_ADMISSION, h(admissions.list));
router.get('/admissions/assign-options', ADMIN, h(admissions.assignOptions));
router.post('/admissions', OPS, uploadLimiter, D_ADMISSION, h(admissions.create));
router.get('/admissions/:id', OPS, D_CHILD_OR_ADMISSION, h(admissions.getOne));
router.put('/admissions/:id/steps/:step', OPS, D_ADMISSION, h(admissions.saveStep));
router.post('/admissions/:id/documents/:key', OPS, uploadLimiter, D_ADMISSION, h(admissions.uploadFile));
router.get('/admissions/:id/files/:fileId', OPS, D_CHILD_OR_ADMISSION, h(admissions.file));
router.post('/admissions/:id/submit', OPS, D_ADMISSION, h(admissions.submit));
// Admin decisions. A non-Admin attempt is refused (403) and written to the Activity log as DENIED.
router.post('/admissions/:id/approve', ADMISSION_DECISION('approve'), ADMIN, h(admissions.approve));
router.post('/admissions/:id/return', ADMISSION_DECISION('return'), ADMIN, h(admissions.returnForCorrection));
router.post('/admissions/:id/decline', ADMISSION_DECISION('decline'), ADMIN, h(admissions.decline));
router.post('/admissions/:id/documents/:key/verify', ADMISSION_DECISION('verify'), ADMIN, h(admissions.verifyDocument)); // reviewing Admin (never the creator)
router.post('/admissions/:id/withdraw', OPS, D_ADMISSION, h(admissions.withdraw)); // creator or Admin: Not Admitted, reason required
// Child record access levels (services/childAccess.js is the one policy for every route below).
router.post('/children/duplicate-check', OPS, D_CHILD_OR_ADMISSION, h(children.duplicateCheck));
router.get('/children/:id/care-card', OPS, D_CHILDREN, h(childAccess.getCareCard));
router.put('/children/:id/care-card', OPS, D_CHILDREN, h(childAccess.saveCareCard));
router.post('/children/:id/care-card/review', OPS, D_CHILDREN, h(childAccess.reviewCareCard));
router.get('/children/:id/case-files', OPS, D_CHILDREN, h(children.getCaseFiles));
router.put('/children/:id/case-files', OPS, D_CHILDREN, h(children.updateCaseFiles));
router.get('/children/:id/access', OPS, D_CHILDREN, h(childAccess.accessTab));
router.post('/children/:id/assignments', ADMIN, h(childAccess.addAssignment));
router.post('/children/:id/access-requests', OPS, D_CHILDREN, h(childAccess.requestAccess));
router.get('/assignments/staff', ADMIN, h(childAccess.assignableStaff));
router.post('/assignments/bulk', ADMIN, h(childAccess.bulkAssign));
router.put('/assignments/:id', ADMIN, h(childAccess.changeAssignment));
router.post('/assignments/:id/end', ADMIN, h(childAccess.endAssignment));
router.get('/access-requests', ADMIN, h(childAccess.listRequests));
router.post('/access-requests/:id/decision', ADMIN, h(childAccess.decideRequest));
// Emergency access was removed: no routes. Earlier uses are kept read-only (Access tab, Admin).
router.get('/reassignment-flags', ADMIN, h(childAccess.flags));
router.get('/monitoring', ADMIN, h(childAccess.currentMonitoring));
router.post('/monitoring', ADMIN, h(childAccess.startMonitoring));
router.post('/monitoring/end', ADMIN, h(childAccess.endMonitoring));
router.get('/child-access/me', OPS, h(childAccess.me));
router.get('/child-access/settings', ADMIN, h(childAccess.getSettings));
router.put('/child-access/settings', ADMIN, h(childAccess.saveSettings));
router.get('/child-access/overview', ADMIN, h(childAccess.overview));
router.get('/child-access/would-block', ADMIN, h(childAccess.wouldBlock));
router.post('/privacy-concerns', OPS, h(childAccess.reportConcern));
router.get('/privacy-concerns', ADMIN, h(childAccess.listConcerns));
router.post('/privacy-concerns/:id/review', ADMIN, h(childAccess.reviewConcern));
router.get('/children/:id', OPS, D_CHILDREN, h(children.getOne));
router.put('/children/:id', OPS, D_CHILDREN, h(children.update));
router.delete('/children/:id', ADMIN, D_CHILDREN, h(children.remove)); // archives (never deletes), reason required
router.post('/children/:id/restore', ADMIN, D_CHILDREN, h(children.restore));
router.get('/children/:id/photo', OPS, D_CHILDREN, h(children.photo));
router.post('/children/:id/photo', OPS, uploadLimiter, D_CHILDREN, h(children.uploadPhoto));
router.delete('/children/:id/photo', OPS, D_CHILDREN, h(children.removePhoto));
// Health records (level 3): 180-second elevated access, enforced here. Case files moved to the core record above.
router.post('/children/:id/health-access', OPS, tokenLimiter, D_HEALTH, h(children.requestHealthAccess));
router.post('/children/:id/health-access/revoke', OPS, D_HEALTH, h(children.revokeHealthAccess));
router.get('/children/:id/protected', OPS, requireHealthAccess, D_HEALTH, h(children.getProtected));
router.put('/children/:id/health', OPS, requireHealthAccess, D_HEALTH, h(children.updateHealth));

// ---------- Public-safe child profiles (donors, applicants) ----------
router.get('/public-children', ANY, h(children.publicList));
router.get('/public-children/:id/photo', ANY, h(children.publicPhoto));

// ---------- Transition Review (18+) ----------
router.get('/transition-reviews', OPS, D_TRANSITION, h(transitions.list));
router.get('/transition-reviews/:id', OPS, D_TRANSITION, h(transitions.getOne));
router.put('/transition-reviews/:id', OPS, D_TRANSITION, h(transitions.update));
router.put('/transition-reviews/:id/assign', ADMIN, D_TRANSITION, h(transitions.assign));
router.post('/transition-reviews/:id/begin-assessment', OPS, D_TRANSITION, h(transitions.beginAssessment));
router.put('/transition-reviews/:id/assessment', OPS, D_TRANSITION, h(transitions.saveAssessment));
router.post('/transition-reviews/:id/conferences', OPS, D_TRANSITION, h(transitions.saveConference));
router.put('/transition-reviews/:id/conferences/:cid', OPS, D_TRANSITION, h(transitions.saveConference));
router.post('/transition-reviews/:id/decision', ADMIN, D_TRANSITION, h(transitions.saveDecision));
router.post('/transition-reviews/:id/tasks', OPS, D_TRANSITION, h(transitions.saveTask));
router.put('/transition-reviews/:id/tasks/:taskId', OPS, D_TRANSITION, h(transitions.saveTask));
router.put('/transition-reviews/:id/preparation', OPS, D_TRANSITION, h(transitions.savePreparation));
router.post('/transition-reviews/:id/discharge', ADMIN, D_TRANSITION, h(transitions.recordDischarge));
router.post('/transition-reviews/:id/aftercare', OPS, D_TRANSITION, h(transitions.recordVisit));
router.post('/transition-reviews/:id/close', ADMIN, D_TRANSITION, h(transitions.close));
router.post('/transition-reviews/:id/documents', OPS, uploadLimiter, D_TRANSITION, h(transitions.uploadDocument));
router.get('/transition-reviews/:id/documents/:docId', OPS, D_TRANSITION, h(transitions.viewDocument));
router.get('/children/:id/transition-summary', OPS, D_TRANSITION, h(transitions.childSummary));

// ---------- Adoption (RA 11642 workflow) ----------
// Same permission groups as before (DONOR, OPS, REVIEWERS, ADMIN). Admin and Staff must also
// have accepted the confidentiality undertaking (RA 11642 Sec. 39); donors only ever reach
// their own application (checked in the controller).
router.get('/adoptions/form-config', REVIEWERS, D_ADOPTION, h(adoptions.formConfig));
router.get('/adoptions/mine', DONOR, D_ADOPTION, h(adoptions.mine));
router.get('/adoptions', OPS, D_ADOPTION, h(adoptions.list));
router.post('/adoptions', DONOR, D_ADOPTION, h(adoptions.createDraft));
router.get('/adoptions/:id', REVIEWERS, D_ADOPTION, h(adoptions.getOne));
router.put('/adoptions/:id', DONOR, D_ADOPTION, h(adoptions.saveDraft));
router.post('/adoptions/:id/submit', DONOR, D_ADOPTION, h(adoptions.submit));
router.post('/adoptions/:id/withdraw', DONOR, D_ADOPTION, h(adoptions.withdraw));
router.post('/adoptions/:id/documents', REVIEWERS, uploadLimiter, D_ADOPTION, h(adoptions.uploadDocument));
router.delete('/adoptions/:id/documents/:docId', DONOR, D_ADOPTION, h(adoptions.deleteDocument));
router.get('/adoptions/:id/documents/:docId', REVIEWERS, D_ADOPTION, h(adoptions.downloadDocument));
router.post('/adoptions/:id/documents/:docId/review', OPS, D_ADOPTION, h(adoptions.reviewDocument));
router.post('/adoptions/:id/verifications/:vid/review', OPS, D_ADOPTION, h(adoptions.reviewVerification));
router.post('/adoptions/:id/verifications/:vid/philsys-check', OPS, philsysLimiter, D_ADOPTION, h(adoptions.philsysCheck));
router.get('/adoptions/:id/matching/preview', OPS, D_ADOPTION, h(matching.preview));
router.post('/adoptions/:id/matches', OPS, D_ADOPTION, h(matching.propose));
router.post('/adoptions/:id/matches/:mid/review', OPS, D_ADOPTION, h(matching.review));
router.post('/adoptions/:id/matches/:mid/approve', ADMIN, D_ADOPTION, h(matching.approve));
router.post('/adoptions/:id/matches/:mid/nacc', ADMIN, D_ADOPTION, h(matching.nacc));
router.post('/adoptions/:id/matches/:mid/withdraw', OPS, D_ADOPTION, h(matching.withdraw));
router.post('/adoptions/:id/link', OPS, D_ADOPTION, h(matching.link));
router.get('/children/:id/match-profile', OPS, D_ADOPTION, h(matching.getProfile));
router.put('/children/:id/match-profile', ADMIN, D_ADOPTION, h(matching.saveProfile));
router.post('/children/:id/match-documents/:key/verify', ADMIN, D_ADOPTION, h(matching.verifyChildDocument));
router.get('/archived-documents', ADMIN, h(archivedDocs.list));
router.post('/archived-documents/:id/dispose', ADMIN, h(archivedDocs.dispose));
router.post('/adoptions/staff-case', OPS, D_ADOPTION, h(stages.createStaffCase));
router.get('/adoption-applicants', OPS, D_ADOPTION, h(stages.applicants));
router.post('/adoptions/:id/stages/:key/record', OPS, D_ADOPTION, h(stages.saveRecord));
router.post('/adoptions/:id/stages/:key/entries', OPS, D_ADOPTION, h(stages.addEntry));
router.post('/adoptions/:id/stages/:key/proceed', OPS, D_ADOPTION, h(stages.proceed));
router.put('/adoptions/:id/case-child', OPS, D_ADOPTION, h(stages.setChild));
router.put('/adoptions/:id/eligibility', OPS, D_ADOPTION, h(stages.saveEligibility));
router.put('/adoptions/:id/pap-answers', OPS, D_ADOPTION, h(stages.papAnswers));
router.get('/adoptions/:id/tab/:tab', OPS, D_ADOPTION, h(adoptionDetail.tab));
router.get('/adoptions/:id/id-scan', REVIEWERS, idScanLimiter, D_ADOPTION, h(adoptions.idScan));
router.put('/adoptions/:id/verifications/:vid', REVIEWERS, D_ADOPTION, h(adoptions.correctVerification));
router.get('/adoptions/:id/documents/:docId/verify', REVIEWERS, D_ADOPTION, h(adoptions.verifyDocument));
router.post('/adoptions/:id/documents/:docId/protect', ADMIN, D_ADOPTION, h(adoptions.protectDocument));
router.put('/adoptions/:id/status', OPS, D_ADOPTION, h(adoptions.updateStatus));
router.post('/adoptions/:id/notes', OPS, D_ADOPTION, h(adoptions.addNote));
router.put('/adoptions/:id/requests/:requestId/close', OPS, D_ADOPTION, h(adoptions.closeRequest));
router.post('/adoptions/:id/archive', ADMIN, D_ADOPTION, h(adoptions.archive));
router.put('/adoptions/:id/assign', ADMIN, D_ADOPTION, h(adoptions.assign));
router.post('/adoptions/:id/releases', ADMIN, D_ADOPTION, h(compliance.createRelease));
router.get('/adoption-matchable-children', OPS, D_ADOPTION, h(childLegal.matchable));
router.get('/adoption-verification-queue', OPS, D_ADOPTION, h(adoptions.verificationQueue));
router.get('/id-types', ADMIN, h(idTypes.list));
router.put('/id-types/:key', ADMIN, h(idTypes.save));

// ---------- Child legal records (CDCLAA, sealed original birth record) ----------
router.put('/children/:id/assign', ADMIN, D_CHILDREN, h(childLegal.assignStaff));
router.get('/children/:id/adoption-history', OPS, D_ADOPTION, h(children.adoptionHistory));
router.get('/children/:id/cdclaa', OPS, D_ADOPTION, h(childLegal.getCdclaa));
router.put('/children/:id/cdclaa', OPS, uploadLimiter, D_ADOPTION, h(childLegal.saveCdclaa));
router.post('/children/:id/cdclaa/verify', ADMIN, D_ADOPTION, h(childLegal.verifyCdclaa));
router.get('/children/:id/sealed-records', ADMIN, D_ADOPTION, h(childLegal.listSealed));
router.post('/children/:id/sealed-records', ADMIN, uploadLimiter, D_ADOPTION, h(childLegal.uploadSealed));

// ---------- Protected records with token access ----------
router.get('/protected/:publicId', OPS, D_ADOPTION, h(protectedRecords.lookup));
router.post('/protected/:publicId/unlock', OPS, tokenLimiter, D_ADOPTION, h(protectedRecords.unlock));
router.post('/protected/:publicId/open-sealed', ADMIN, tokenLimiter, D_ADOPTION, h(protectedRecords.openSealed));
router.get('/protected/:publicId/view', OPS, D_ADOPTION, h(protectedRecords.view));
router.get('/protected/:publicId/download', OPS, D_ADOPTION, h(protectedRecords.download));
router.get('/protected-records', ADMIN, D_ADOPTION, h(protectedRecords.listRecords));
router.put('/protected-records/:recordId', ADMIN, D_ADOPTION, h(protectedRecords.updateRecord));
router.post('/protected-records/:recordId/tokens', ADMIN, D_ADOPTION, h(protectedRecords.issueToken));
router.post('/protected-tokens/:tokenId/revoke', ADMIN, h(protectedRecords.revokeToken));
router.get('/protected-access', ADMIN, h(protectedRecords.overview));
router.post('/qr-prints', OPS, h(adoptions.logQrPrint));

// ---------- Unlock flow for sensitive records (purpose + QR + single-use Token ID) ----------
router.get('/unlock/options', OPS, h(unlock.options));
router.post('/unlock/challenges', OPS, requireDutyForUnlock, tokenLimiter, h(unlock.createChallenge));
router.post('/unlock/verify', OPS, requireDutyForUnlock, tokenLimiter, h(unlock.verify));
router.post('/unlock/lock', OPS, h(unlock.lock));
router.post('/unlock/events', OPS, h(unlock.clientEvent));
router.get('/unlock/sessions/active', ADMIN, h(unlock.active));
router.get('/unlock/sessions', ADMIN, h(unlock.sessions));
router.post('/unlock/sessions/:id/revoke', ADMIN, h(unlock.revoke));

// ---------- Notifications (every signed-in user sees only their own) ----------
router.get('/notifications', REVIEWERS, h(notifications.list));
router.get('/notifications/counts', REVIEWERS, h(notifications.counts));
router.get('/notifications/unread-count', REVIEWERS, h(notifications.unreadCount));
router.get('/notifications/preferences', REVIEWERS, h(notifications.preferences));
router.put('/notifications/preferences', REVIEWERS, h(notifications.setPreference));
router.get('/notifications/cleanup', ADMIN, h(notifications.cleanupPreview));
router.post('/notifications/cleanup', ADMIN, h(notifications.cleanupRun));
router.post('/notifications/read-all', REVIEWERS, h(notifications.markAllRead));
router.post('/notifications/bulk', REVIEWERS, h(notifications.bulk));
router.post('/notifications/read-application/:applicationId', REVIEWERS, h(notifications.markApplicationRead));
router.post('/notifications/:id/open', REVIEWERS, h(notifications.open));
router.post('/notifications/:id/read', REVIEWERS, h(notifications.markRead));
router.post('/notifications/:id/unread', REVIEWERS, h(notifications.markUnread));

// ---------- Compliance (RA 11642 Sec. 39, RA 10173, RA 10175) ----------
router.get('/releases', ADMIN, h(compliance.listReleases));
router.post('/privacy-requests', DONOR, h(compliance.createPrivacyRequest));
router.get('/privacy-requests/mine', DONOR, h(compliance.myPrivacyRequests));
router.get('/privacy-requests', OPS, h(compliance.listPrivacyRequests));
router.put('/privacy-requests/:id', OPS, h(compliance.updatePrivacyRequest));
router.post('/security/capture-attempts', ANY, captureLimiter, h(compliance.captureAttempt));
router.get('/security-incidents', ADMIN, h(compliance.listIncidents));
router.post('/security-incidents', ADMIN, h(compliance.createIncident));
router.put('/security-incidents/:id', ADMIN, h(compliance.updateIncident));
router.get('/security-events', ADMIN, h(compliance.securityEvents));

// ---------- Inventory (no QR) ----------
router.get('/inventory', OPS, D_INVENTORY, h(inventory.list));
router.get('/inventory/low-stock-count', OPS, D_INVENTORY, h(inventory.lowStockCount));
router.post('/inventory', OPS, D_INVENTORY, h(inventory.create));
router.put('/inventory/:id', OPS, D_INVENTORY, h(inventory.update));
router.get('/inventory/options', OPS, D_INVENTORY, h(inventory.options));
router.get('/inventory/reports', OPS, D_INVENTORY, h(inventory.reports));
router.get('/inventory/:id/movements', OPS, D_INVENTORY, h(inventory.history));
router.post('/inventory/:id/movements', OPS, D_INVENTORY, h(inventory.movement)); // Stock in / out / Adjustment / Disposal, reason required
router.post('/inventory/:id/adjust', OPS, D_INVENTORY, h(inventory.adjust)); // the - / + buttons: same body as /movements
router.delete('/inventory/:id', OPS, D_INVENTORY, h(inventory.remove)); // archives (never deletes), reason required
router.post('/inventory/:id/restore', ADMIN, D_INVENTORY, h(inventory.restore));

// ---------- Donations ----------
router.get('/donations', OPS, D_DONATIONS, h(donations.list));
// QR donations: the To verify queue and verification (Admin, or Staff with Donations + Donations: cash verification;
// the service checks the second duty and the separation of duties).
router.get('/donations/to-verify', OPS, D_DONATIONS, h(claimsCtl.queue));
router.post('/donations/approvals/:id', OPS, D_DONATIONS, h(claimsCtl.decide));
router.get('/reconciliation', OPS, D_DONATIONS, h(claimsCtl.reconciliation));
router.post('/reconciliation/imports', OPS, uploadLimiter, D_DONATIONS, h(claimsCtl.importStatement));
router.post('/reconciliation/lines/:id/convert', OPS, D_DONATIONS, h(claimsCtl.convertLine));
router.post('/reconciliation/lines/:id/dismiss', OPS, D_DONATIONS, h(claimsCtl.dismissLine));
router.get('/cash-counts', OPS, D_DONATIONS, h(claimsCtl.cashCounts));
router.post('/cash-counts', OPS, D_DONATIONS, h(claimsCtl.submitCashCount));
router.post('/cash-counts/:id/sign-off', ADMIN, h(claimsCtl.signOffCashCount));
router.get('/donations/options', OPS, D_DONATIONS, h(donations.options));
router.get('/donations/methods', OPS, D_DONATIONS, h(donations.methods));
router.get('/donations/donors', OPS, D_DONATIONS, h(donations.donors));
router.get('/donations/inventory-items', OPS, D_DONATIONS, h(donations.inventoryItems));
router.get('/donations/export', OPS, D_DONATIONS, h(donations.exportCsv));
router.get('/donations/reports', OPS, D_DONATIONS, h(donations.reports));
router.get('/donations/verify/:code', OPS, verifyLimiter, verifyGlobalLimiter, D_DONATIONS, h(donations.verify));
router.post('/donations', OPS, D_DONATIONS, h(donations.create));
router.get('/donations/:id', OPS, D_DONATIONS, h(donations.getOne));
router.put('/donations/:id', OPS, D_DONATIONS, h(donations.update));
router.post('/donations/:id/status', OPS, D_DONATIONS, h(donations.transition));
router.put('/donations/:id/status', OPS, D_DONATIONS, h(donations.updateStatus));
router.post('/donations/:id/acknowledgment', OPS, D_DONATIONS, h(donations.acknowledge));
router.put('/donations/:id/allocation', OPS, D_DONATIONS, h(donations.setAllocation));
router.post('/donations/:id/corrections', OPS, D_DONATIONS, h(donations.correct));
router.put('/donations/:id/items/:lineId', OPS, D_DONATIONS, h(donations.updateItem));
router.post('/donations/:id/distributions', OPS, D_DONATIONS, h(donations.distribute));
router.post('/donations/:id/utilization', OPS, D_DONATIONS, h(donations.utilize));
router.post('/donations/:id/void', ADMIN, D_DONATIONS, h(donations.voidDonation));
router.post('/donations/:id/verify', OPS, D_DONATIONS, h(claimsCtl.verify));
router.post('/donations/:id/not-matched', OPS, D_DONATIONS, h(claimsCtl.notMatched));
router.post('/donations/:id/request-details', OPS, D_DONATIONS, h(claimsCtl.requestDetails));
router.post('/donations/:id/reopen', OPS, D_DONATIONS, h(claimsCtl.reopen));
router.post('/donations/:id/claim-notes', OPS, D_DONATIONS, h(claimsCtl.internalNote));
router.post('/donations/:id/confirm-cash', OPS, D_DONATIONS, h(claimsCtl.confirmCash));
router.post('/donations/:id/void-request', OPS, D_DONATIONS, h(donations.requestVoid));
router.post('/donations/:id/void-request/decline', ADMIN, D_DONATIONS, h(donations.declineVoid));
router.post('/donations/:id/documents', OPS, uploadLimiter, D_DONATIONS, h(donations.uploadDocument));
router.get('/donations/:id/documents/:docId/link', OPS, D_DONATIONS, h(donations.documentLink));
// The acknowledgment PDF: a signed link first (donors only their own; checked again when the file is sent).
router.get('/donations/:id/receipt/link', ANY, D_DONATIONS, h(donations.receiptLink));
// Files (donation documents and proofs, QR images, acknowledgments): only through short-lived signed links.
router.get('/files/:token', ANY, fileLimiter, h(claimsCtl.file));
// Donations are never deleted: DELETE /donations/:id is gone (Void instead).
router.get('/donor-records', OPS, D_DONATIONS, h(donorRecords.list));
router.get('/donor-records/duplicates', OPS, D_DONATIONS, h(donorRecords.duplicates));
router.get('/donor-records/:id', OPS, D_DONATIONS, h(donorRecords.getOne));
router.post('/donor-records/:id/reveal', OPS, D_DONATIONS, h(donorRecords.reveal));

// ---------- Donor portal ----------
router.get('/donor/summary', DONOR, h(donor.summary));
router.get('/donor/needed-stocks', DONOR, h(donor.neededStocks));
router.get('/donor/child-needs', DONOR, h(donor.childNeeds));
router.get('/donor/history', DONOR, h(donor.history));
router.post('/donor/donations', DONOR, h(donor.donate));
// QR donations (no online payment processing): the donor gives through the home's QR codes in their own app, then
// reports it here. The report waits for the home to verify it; it is never counted before that.
router.get('/donor/donate-options', DONOR, h(claimsCtl.donateOptions));
router.post('/donor/donation-reports', DONOR, claimUserLimiter, claimIpLimiter, uploadLimiter, h(claimsCtl.report));
router.post('/donor/donation-reports/:id/withdraw', DONOR, claimUserLimiter, h(claimsCtl.withdraw));
router.post('/donor/donation-reports/:id/info', DONOR, claimUserLimiter, uploadLimiter, h(claimsCtl.addInfo));
router.post('/donor/qr-problems', DONOR, claimUserLimiter, h(claimsCtl.reportQrProblem));
// Settings > Payment QR (Admin only; changes need re-authentication and, with two or more Admins, a second Admin).
router.post('/auth/reauth', ADMIN, reauthLimiter, mfaLimiter, h(claimsCtl.reauth));
router.get('/payment-qr', ADMIN, h(claimsCtl.qrList));
router.get('/payment-qr/sheet', ADMIN, h(claimsCtl.qrSheet));
router.post('/payment-qr/preview', ADMIN, uploadLimiter, h(claimsCtl.qrPreview));
router.post('/payment-qr/changes', ADMIN, uploadLimiter, h(claimsCtl.qrRequestChange));
router.post('/payment-qr/changes/:id/approve', ADMIN, h(claimsCtl.qrApprove));
router.post('/payment-qr/changes/:id/reject', ADMIN, h(claimsCtl.qrReject));
router.post('/payment-qr/changes/:id/cancel', ADMIN, h(claimsCtl.qrCancel));
router.put('/payment-qr/methods/:id', ADMIN, h(claimsCtl.qrUpdateMethod));
router.post('/payment-qr/methods/:id/confirm', ADMIN, h(claimsCtl.qrConfirm));
router.get('/payment-qr/methods/:id/versions', ADMIN, h(claimsCtl.qrVersions));
router.post('/payment-qr/problems/:id/resolve', ADMIN, h(claimsCtl.qrResolveProblem));

// ---------- Visitors (manual log, no QR) ----------
router.get('/visitors/filter-options', OPS, D_VISITORS, h(visitors.filterOptions));
router.get('/visitors', OPS, D_VISITORS, h(visitors.list));
router.post('/visitors', OPS, D_VISITORS, h(visitors.checkIn));
router.put('/visitors/:id', OPS, D_VISITORS, h(visitors.update));
router.put('/visitors/:id/check-out', OPS, D_VISITORS, h(visitors.checkOut));
router.delete('/visitors/:id', ADMIN, D_VISITORS, h(visitors.remove));

// ---------- Meals ----------
router.get('/meals', OPS, D_MEALS, h(meals.list));
router.post('/meals', OPS, D_MEALS, h(meals.create));
router.put('/meals/:id', OPS, D_MEALS, h(meals.update));
router.delete('/meals/:id', ADMIN, D_MEALS, h(meals.remove));

// ---------- Staff schedules ----------
router.get('/schedules/mine', OPS, h(schedules.mine));
router.get('/schedules', ADMIN, h(schedules.list));
router.post('/schedules/bulk', ADMIN, h(schedules.bulk));
router.post('/schedules/copy', ADMIN, h(schedules.copy));
router.post('/schedules/batches/:id/undo', ADMIN, h(schedules.undo));
router.put('/schedules/day/:date', ADMIN, h(schedules.saveDay));
router.post('/schedules', ADMIN, h(schedules.create));
router.put('/schedules/:id', ADMIN, h(schedules.update));
router.delete('/schedules/:id', ADMIN, h(schedules.remove));
router.get('/schedule-areas', OPS, h(schedules.areas));
router.get('/schedule-areas/unmapped', ADMIN, h(schedules.unmapped));
router.post('/schedule-areas/map', ADMIN, h(schedules.mapArea));
router.post('/schedule-areas', ADMIN, h(schedules.createArea));
router.put('/schedule-areas/:id', ADMIN, h(schedules.updateArea));

// ---------- User accounts ----------
router.get('/users/duties', ADMIN, h(users.dutyOptions));
router.get('/users', ADMIN, h(users.list));
router.put('/users/:id/duties', ADMIN, h(users.setDuties));
router.post('/users', ADMIN, h(users.create));
router.put('/users/:id', ADMIN, h(users.update));
// Accounts are deactivated, never deleted, so their history is kept.
router.put('/users/:id/active', ADMIN, h(users.setActive));
router.post('/users/:id/mfa/reset', ADMIN, tokenLimiter, h(users.resetMfa));

// ---------- Settings ----------
router.get('/settings', h(settings.get));
router.put('/settings', ADMIN, h(settings.update));

// ---------- Audit log + reports ----------
router.get('/audit-logs', ADMIN, h(audit.list));
router.get('/audit-logs/options', ADMIN, h(audit.options));
router.get('/audit-logs/export', ADMIN, h(audit.exportXlsx));
router.get('/reports/compliance', ADMIN, h(audit.complianceReport));

module.exports = router;
