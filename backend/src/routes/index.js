const express = require('express');
const h = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { requireHealthAccess } = require('../services/healthAccessService');

const auth = require('../controllers/authController');
const qr = require('../controllers/qrController');
const children = require('../controllers/childController');
const adoptions = require('../controllers/adoptionController');
const transitions = require('../controllers/transitionController');
const inventory = require('../controllers/inventoryController');
const donations = require('../controllers/donationController');
const donor = require('../controllers/donorController');
const visitors = require('../controllers/visitorController');
const meals = require('../controllers/mealController');
const schedules = require('../controllers/scheduleController');
const users = require('../controllers/userController');
const settings = require('../controllers/settingsController');
const audit = require('../controllers/auditController');
const dashboard = require('../controllers/dashboardController');

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
router.post('/qr/generate-token', OPS, tokenLimiter, h(qr.generateToken));
router.post('/qr/validate', OPS, tokenLimiter, h(qr.validate));
router.post('/qr/revoke', ADMIN, h(qr.revoke));

// ---------- Dashboard ----------
router.get('/dashboard/summary', OPS, h(dashboard.summary));

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
router.get('/transition-reviews', OPS, h(transitions.list));
router.put('/transition-reviews/:id', OPS, h(transitions.update));

// ---------- Adoption ----------
router.get('/adoptions/document-types', ANY, h(adoptions.documentTypes));
router.get('/adoptions/summary', OPS, h(adoptions.summary));
router.get('/adoptions/mine', DONOR, h(adoptions.mine));
router.get('/adoptions', OPS, h(adoptions.list));
router.post('/adoptions', DONOR, h(adoptions.submit));
router.get('/adoptions/:id', REVIEWERS, h(adoptions.getOne));
router.post('/adoptions/:id/documents', authorize('Admin', 'Donor'), uploadLimiter, h(adoptions.uploadDocument));
router.get('/adoptions/:id/documents/:docId', REVIEWERS, h(adoptions.downloadDocument));
router.post('/adoptions/:id/notes', OPS, h(adoptions.addNote));
router.put('/adoptions/:id/status', OPS, h(adoptions.updateStatus));

// ---------- Inventory (no QR) ----------
router.get('/inventory', OPS, h(inventory.list));
router.get('/inventory/low-stock-count', OPS, h(inventory.lowStockCount));
router.post('/inventory', OPS, h(inventory.create));
router.put('/inventory/:id', OPS, h(inventory.update));
router.delete('/inventory/:id', OPS, h(inventory.remove));

// ---------- Donations ----------
router.get('/donations', OPS, h(donations.list));
router.get('/donations/donors', OPS, h(donations.donors));
router.get('/donations/verify/:code', OPS, h(donations.verify));
router.post('/donations', OPS, h(donations.create));
router.put('/donations/:id/status', OPS, h(donations.updateStatus));
router.put('/donations/:id/allocation', OPS, h(donations.updateAllocation));
router.delete('/donations/:id', ADMIN, h(donations.remove));
router.get('/donations/:id/receipt', ANY, h(donations.receipt));

// ---------- Donor portal ----------
router.get('/donor/summary', DONOR, h(donor.summary));
router.get('/donor/needed-stocks', DONOR, h(donor.neededStocks));
router.get('/donor/child-needs', DONOR, h(donor.childNeeds));
router.get('/donor/history', DONOR, h(donor.history));
router.post('/donor/donations', DONOR, h(donor.donate));

// ---------- Visitors (manual log, no QR) ----------
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
router.post('/schedules', ADMIN, h(schedules.create));
router.put('/schedules/:id', ADMIN, h(schedules.update));
router.delete('/schedules/:id', ADMIN, h(schedules.remove));

// ---------- User accounts ----------
router.get('/users', ADMIN, h(users.list));
router.post('/users', ADMIN, h(users.create));
router.put('/users/:id', ADMIN, h(users.update));
router.delete('/users/:id', ADMIN, h(users.remove));
router.post('/users/:id/mfa/reset', ADMIN, tokenLimiter, h(users.resetMfa));

// ---------- Settings ----------
router.get('/settings', h(settings.get));
router.put('/settings', ADMIN, h(settings.update));

// ---------- Audit log + reports ----------
router.get('/audit-logs', ADMIN, h(audit.list));
router.get('/audit-logs/export', ADMIN, h(audit.exportXlsx));
router.get('/audit-logs/health-access', ADMIN, h(audit.healthAccess));
router.get('/reports/compliance', ADMIN, h(audit.complianceReport));

module.exports = router;
