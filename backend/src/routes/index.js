const express = require('express');
const h = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { requireDuty, requireDutyForUnlock } = require('../middleware/requireDuty');
// Staff duties per area (Admin and Donors pass). See config/staffDuties.js.
const D_CHILDREN = requireDuty('children');
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
const payments = require('../controllers/paymentController');
const protectedRecords = require('../controllers/protectedRecordController');
const adoptionDetail = require('../controllers/adoptionDetailController');
const stages = require('../controllers/adoptionStageController');
const archivedDocs = require('../controllers/archivedDocumentController');
const matching = require('../controllers/matchingController');
const childLegal = require('../controllers/childLegalController');

const router = express.Router();
const ADMIN = authorize('Admin');
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

// Everything below requires a valid session.
router.use(authenticate);

// ---------- Typed tokens (60 s) for health access ----------

// ---------- Dashboard ----------
router.get('/dashboard/summary', OPS, h(dashboard.summary));
router.get('/dashboard/due-soon', OPS, D_ADOPTION, h(dashboard.dueSoon)); // adoption deadlines

// ---------- Children ----------
router.get('/children/rules', ANY, h(children.rules));
router.get('/children', OPS, D_CHILDREN, h(children.list));
router.post('/children', OPS, uploadLimiter, D_CHILDREN, h(children.create));
router.get('/children/:id', OPS, D_CHILDREN, h(children.getOne));
router.put('/children/:id', OPS, D_CHILDREN, h(children.update));
router.delete('/children/:id', ADMIN, D_CHILDREN, h(children.remove));
router.get('/children/:id/photo', OPS, D_CHILDREN, h(children.photo));
router.post('/children/:id/photo', OPS, uploadLimiter, D_CHILDREN, h(children.uploadPhoto));
router.delete('/children/:id/photo', OPS, D_CHILDREN, h(children.removePhoto));
// Health records + case files: 180-second elevated access, enforced here.
router.post('/children/:id/health-access', OPS, tokenLimiter, D_HEALTH, h(children.requestHealthAccess));
router.post('/children/:id/health-access/revoke', OPS, D_HEALTH, h(children.revokeHealthAccess));
router.get('/children/:id/protected', OPS, requireHealthAccess, D_HEALTH, h(children.getProtected));
router.put('/children/:id/health', OPS, requireHealthAccess, D_HEALTH, h(children.updateHealth));
router.put('/children/:id/case-files', OPS, requireHealthAccess, D_HEALTH, h(children.updateCaseFiles));

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
router.delete('/inventory/:id', OPS, D_INVENTORY, h(inventory.remove));

// ---------- Donations ----------
router.get('/donations', OPS, D_DONATIONS, h(donations.list));
router.get('/donations/options', OPS, D_DONATIONS, h(donations.options));
router.get('/donations/methods', OPS, D_DONATIONS, h(donations.methods));
router.get('/donations/donors', OPS, D_DONATIONS, h(donations.donors));
router.get('/donations/inventory-items', OPS, D_DONATIONS, h(donations.inventoryItems));
router.get('/donations/export', OPS, D_DONATIONS, h(donations.exportCsv));
router.get('/donations/reports', OPS, D_DONATIONS, h(donations.reports));
router.get('/donations/verify/:code', OPS, verifyLimiter, D_DONATIONS, h(donations.verify));
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
router.post('/donations/:id/void-request', OPS, D_DONATIONS, h(donations.requestVoid));
router.post('/donations/:id/void-request/decline', ADMIN, D_DONATIONS, h(donations.declineVoid));
router.post('/donations/:id/documents', OPS, uploadLimiter, D_DONATIONS, h(donations.uploadDocument));
router.get('/donations/:id/documents/:docId', OPS, D_DONATIONS, h(donations.viewDocument));
router.get('/donations/:id/receipt', ANY, D_DONATIONS, h(donations.receipt));
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
// Donor payments: e-wallets through PayMongo, bank transfer with proof (the webhook is in server.js, raw body).
const paymentLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: 'Too many payment attempts. Please wait a few minutes.' });
router.get('/payments/options', DONOR, h(payments.options));
router.post('/payments/checkout', DONOR, paymentLimiter, h(payments.checkout));
router.post('/payments/bank', DONOR, paymentLimiter, h(payments.bank));
router.get('/donor/payments', DONOR, h(payments.mine));
router.get('/donor/payments/:id', DONOR, h(payments.mineOne));
router.get('/payments', OPS, D_DONATIONS, h(payments.list));
router.post('/payments/:id/verify', OPS, D_DONATIONS, h(payments.verify));
router.get('/payments/:id/proof', REVIEWERS, D_DONATIONS, h(payments.proof));
router.get('/payment-methods', ADMIN, h(payments.methods));
router.put('/payment-methods/:id', ADMIN, h(payments.updateMethod));

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
