const express = require('express');
const h = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { requireHealthAccess } = require('../services/healthAccessService');

const auth = require('../controllers/authController');
const children = require('../controllers/childController');
const adoptions = require('../controllers/adoptionController');
const transitions = require('../controllers/transitionController');
const inventory = require('../controllers/inventoryController');
const donations = require('../controllers/donationController');
const donor = require('../controllers/donorController');
const visitors = require('../controllers/visitorController');
const meals = require('../controllers/mealController');
const schedules = require('../controllers/scheduleController');
const recordAccess = require('../controllers/recordAccessController');
const users = require('../controllers/userController');
const settings = require('../controllers/settingsController');
const audit = require('../controllers/auditController');
const dashboard = require('../controllers/dashboardController');
const compliance = require('../controllers/complianceController');
const notifications = require('../controllers/notificationController');
const unlock = require('../controllers/unlockController');
const payments = require('../controllers/paymentController');
const protectedRecords = require('../controllers/protectedRecordController');
const childLegal = require('../controllers/childLegalController');
const { requireUndertaking, requireUndertakingForUnlock } = require('../middleware/requireUndertaking');
// Confidentiality undertaking, per area and sign-in session (config/undertaking.js).
const CU = requireUndertaking('adoption');        // adoption data: the area's undertaking for this session
const CU_TR = requireUndertaking('transition');   // transition review data

const router = express.Router();
const ADMIN = authorize('Admin');
const OPS = authorize('Admin', 'Staff');
// Donor accounts include the adoption-applicant features (Adopt a Child, My applications).
const DONOR = authorize('Donor');
const ANY = authorize('Admin', 'Staff', 'Donor');
const REVIEWERS = authorize('Admin', 'Staff', 'Donor'); // Donors: own applications only (checked in controller)

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
const tokenLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: 'Too many verification attempts. Wait a minute and try again.' });
const mfaLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 15, message: 'Too many verification attempts. Wait 5 minutes and try again.' });
const verifyLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Too many receipt checks. Wait a minute and try again.' });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'Too many uploads. Wait a minute and try again.' });

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
router.get('/dashboard/due-soon', OPS, CU, h(dashboard.dueSoon)); // adoption deadlines

// ---------- Children ----------
router.get('/children/rules', ANY, h(children.rules));
router.get('/children', OPS, h(children.list));
router.post('/children', OPS, uploadLimiter, h(children.create));
router.get('/children/:id', OPS, h(children.getOne));
router.put('/children/:id', OPS, h(children.update));
router.delete('/children/:id', ADMIN, h(children.remove));
router.get('/children/:id/photo', OPS, h(children.photo));
router.post('/children/:id/photo', OPS, uploadLimiter, h(children.uploadPhoto));
router.delete('/children/:id/photo', OPS, h(children.removePhoto));
// Health records + case files: 180-second elevated access, enforced here.
router.post('/children/:id/health-access', OPS, tokenLimiter, h(children.requestHealthAccess));
router.post('/children/:id/health-access/revoke', OPS, h(children.revokeHealthAccess));
router.get('/children/:id/protected', OPS, requireHealthAccess, h(children.getProtected));
router.put('/children/:id/health', OPS, requireHealthAccess, h(children.updateHealth));
router.put('/children/:id/case-files', OPS, requireHealthAccess, h(children.updateCaseFiles));

// ---------- Public-safe child profiles (donors, applicants) ----------
router.get('/public-children', ANY, h(children.publicList));
router.get('/public-children/:id/photo', ANY, h(children.publicPhoto));

// ---------- Transition Review (18+) ----------
router.get('/transition-reviews', OPS, CU_TR, h(transitions.list));
router.get('/transition-reviews/:id', OPS, CU_TR, h(transitions.getOne));
router.put('/transition-reviews/:id', OPS, CU_TR, h(transitions.update));
router.put('/transition-reviews/:id/assign', ADMIN, CU_TR, h(transitions.assign));

// ---------- Adoption (RA 11642 workflow) ----------
// Same permission groups as before (DONOR, OPS, REVIEWERS, ADMIN). Admin and Staff must also
// have accepted the confidentiality undertaking (RA 11642 Sec. 39); donors only ever reach
// their own application (checked in the controller).
router.get('/adoptions/form-config', REVIEWERS, h(adoptions.formConfig));
router.get('/adoptions/mine', DONOR, h(adoptions.mine));
router.get('/adoptions', OPS, CU, h(adoptions.list));
router.post('/adoptions', DONOR, h(adoptions.createDraft));
router.get('/adoptions/:id', REVIEWERS, CU, h(adoptions.getOne));
router.put('/adoptions/:id', DONOR, h(adoptions.saveDraft));
router.post('/adoptions/:id/submit', DONOR, h(adoptions.submit));
router.post('/adoptions/:id/withdraw', DONOR, h(adoptions.withdraw));
router.post('/adoptions/:id/documents', REVIEWERS, CU, uploadLimiter, h(adoptions.uploadDocument));
router.delete('/adoptions/:id/documents/:docId', DONOR, h(adoptions.deleteDocument));
router.get('/adoptions/:id/documents/:docId', REVIEWERS, CU, h(adoptions.downloadDocument));
router.get('/adoptions/:id/documents/:docId/verify', REVIEWERS, CU, h(adoptions.verifyDocument));
router.post('/adoptions/:id/documents/:docId/protect', ADMIN, CU, h(adoptions.protectDocument));
router.put('/adoptions/:id/status', OPS, CU, h(adoptions.updateStatus));
router.post('/adoptions/:id/notes', OPS, CU, h(adoptions.addNote));
router.put('/adoptions/:id/requests/:requestId/close', OPS, CU, h(adoptions.closeRequest));
router.post('/adoptions/:id/archive', ADMIN, CU, h(adoptions.archive));
router.put('/adoptions/:id/assign', ADMIN, CU, h(adoptions.assign));
router.post('/adoptions/:id/releases', ADMIN, CU, h(compliance.createRelease));
router.get('/adoption-matchable-children', OPS, CU, h(childLegal.matchable));

// ---------- Child legal records (CDCLAA, sealed original birth record) ----------
router.put('/children/:id/assign', ADMIN, h(childLegal.assignStaff));
router.get('/children/:id/adoption-history', OPS, CU, h(children.adoptionHistory));
router.get('/children/:id/cdclaa', OPS, CU, h(childLegal.getCdclaa));
router.put('/children/:id/cdclaa', OPS, CU, uploadLimiter, h(childLegal.saveCdclaa));
router.post('/children/:id/cdclaa/verify', ADMIN, CU, h(childLegal.verifyCdclaa));
router.get('/children/:id/sealed-records', ADMIN, CU, h(childLegal.listSealed));
router.post('/children/:id/sealed-records', ADMIN, CU, uploadLimiter, h(childLegal.uploadSealed));

// ---------- Protected records with token access ----------
router.get('/protected/:publicId', OPS, CU, h(protectedRecords.lookup));
router.post('/protected/:publicId/unlock', OPS, CU, tokenLimiter, h(protectedRecords.unlock));
router.post('/protected/:publicId/open-sealed', ADMIN, CU, tokenLimiter, h(protectedRecords.openSealed));
router.get('/protected/:publicId/view', OPS, CU, h(protectedRecords.view));
router.get('/protected/:publicId/download', OPS, CU, h(protectedRecords.download));
router.get('/protected-records', ADMIN, CU, h(protectedRecords.listRecords));
router.put('/protected-records/:recordId', ADMIN, CU, h(protectedRecords.updateRecord));
router.post('/protected-records/:recordId/tokens', ADMIN, CU, h(protectedRecords.issueToken));
router.post('/protected-tokens/:tokenId/revoke', ADMIN, h(protectedRecords.revokeToken));
router.get('/protected-access', ADMIN, h(protectedRecords.overview));
router.post('/qr-prints', OPS, h(adoptions.logQrPrint));

// ---------- Unlock flow for sensitive records (purpose + QR + single-use Token ID) ----------
router.get('/unlock/options', OPS, h(unlock.options));
router.post('/unlock/challenges', OPS, requireUndertakingForUnlock, tokenLimiter, h(unlock.createChallenge));
router.post('/unlock/verify', OPS, requireUndertakingForUnlock, tokenLimiter, h(unlock.verify));
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
router.get('/compliance/undertaking', OPS, h(compliance.undertaking));
router.post('/compliance/undertaking', OPS, h(compliance.acceptUndertaking));
router.post('/compliance/undertaking/decline', OPS, h(compliance.declineUndertaking));
router.get('/compliance/undertaking/versions', ADMIN, h(compliance.undertakingVersions));
router.put('/compliance/undertaking', ADMIN, h(compliance.updateUndertaking));
router.get('/releases', ADMIN, CU, h(compliance.listReleases));
router.post('/privacy-requests', DONOR, h(compliance.createPrivacyRequest));
router.get('/privacy-requests/mine', DONOR, h(compliance.myPrivacyRequests));
router.get('/privacy-requests', OPS, h(compliance.listPrivacyRequests));
router.put('/privacy-requests/:id', OPS, h(compliance.updatePrivacyRequest));
router.get('/security-incidents', ADMIN, h(compliance.listIncidents));
router.post('/security-incidents', ADMIN, h(compliance.createIncident));
router.put('/security-incidents/:id', ADMIN, h(compliance.updateIncident));
router.get('/security-events', ADMIN, h(compliance.securityEvents));

// ---------- Inventory (no QR) ----------
router.get('/inventory', OPS, h(inventory.list));
router.get('/inventory/low-stock-count', OPS, h(inventory.lowStockCount));
router.post('/inventory', OPS, h(inventory.create));
router.put('/inventory/:id', OPS, h(inventory.update));
router.delete('/inventory/:id', OPS, h(inventory.remove));

// ---------- Donations ----------
router.get('/donations', OPS, h(donations.list));
router.get('/donations/methods', OPS, h(donations.methods));
router.get('/donations/donors', OPS, h(donations.donors));
router.get('/donations/verify/:code', OPS, verifyLimiter, h(donations.verify));
router.post('/donations', OPS, h(donations.create));
router.put('/donations/:id/status', OPS, h(donations.updateStatus));
router.put('/donations/:id', OPS, h(donations.update));
router.delete('/donations/:id', ADMIN, h(donations.remove));
router.get('/donations/:id/receipt', ANY, h(donations.receipt));

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
router.get('/payments', OPS, h(payments.list));
router.post('/payments/:id/verify', OPS, h(payments.verify));
router.get('/payments/:id/proof', REVIEWERS, h(payments.proof));
router.get('/payment-methods', ADMIN, h(payments.methods));
router.put('/payment-methods/:id', ADMIN, h(payments.updateMethod));

// ---------- Visitors (manual log, no QR) ----------
router.get('/visitors/filter-options', OPS, h(visitors.filterOptions));
router.get('/visitors', OPS, h(visitors.list));
router.post('/visitors', OPS, h(visitors.checkIn));
router.put('/visitors/:id', OPS, h(visitors.update));
router.put('/visitors/:id/check-out', OPS, h(visitors.checkOut));
router.delete('/visitors/:id', ADMIN, h(visitors.remove));

// ---------- Meals ----------
router.get('/meals', OPS, h(meals.list));
router.post('/meals', OPS, h(meals.create));
router.put('/meals/:id', OPS, h(meals.update));
router.put('/meals/:id/active', OPS, h(meals.setActive));
router.delete('/meals/:id', ADMIN, h(meals.remove));

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
router.get('/record-access', ADMIN, h(recordAccess.overview));
router.post('/record-access/assign', ADMIN, h(recordAccess.assign));
router.get('/schedule-areas', OPS, h(schedules.areas));
router.get('/schedule-areas/unmapped', ADMIN, h(schedules.unmapped));
router.post('/schedule-areas/map', ADMIN, h(schedules.mapArea));
router.post('/schedule-areas', ADMIN, h(schedules.createArea));
router.put('/schedule-areas/:id', ADMIN, h(schedules.updateArea));

// ---------- User accounts ----------
router.get('/users', ADMIN, h(users.list));
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
