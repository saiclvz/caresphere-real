# QR-only donations and security audit: report

## Removed
- **Backend:**
  - `src/services/paymongo.js`, `src/services/paymentService.js` and `src/controllers/paymentController.js`.
  - The PayMongo webhook route and its signature check, and the checkout, bank-transfer, payment-options and payment-method routes (`/payments/*`, `/donor/payments`, `/payment-methods`).
  - The stale-payment expiry job.
  - The gateway notification events: donation paid, transfer received/confirmed/rejected, payment failed, admin payment failed, webhook error, transfer pending.
- **Frontend:**
  - `pages/DonateResult.jsx`. `/donate/result` now redirects to Donation history.
  - `components/BankTransferQueue.jsx` and `components/PaymentSettings.jsx`.
  - The "Demo mode" notice, the checkout buttons, and the "Default allocation for online donations" field.
- **`.env.example`:** `PAYMONGO_SECRET_KEY`, `PAYMONGO_PUBLIC_KEY`, `PAYMONGO_WEBHOOK_SECRET` and `PUBLIC_APP_URL`.
- **Packages:** none removed. PayMongo was called directly over HTTPS, not through an SDK. `jsqr` stays because it decodes QR codes (ID scanning, and now the Payment QR check).
- **Kept read-only:** the `tbl_payments` and `tbl_payment_webhook_events` tables. Triggers refuse insert, update and delete. Their audit entries are kept, and the old audit-log labels are kept so old entries still read correctly.

## Added
- **Backend services:**
  - QR handling: `paymentQr` (Payment QR changes, versions, sheet and problem reports) and `qrImage` (decode, QR Ph EMV name check, re-encode).
  - Donor reports: `donationClaims` (reports, the To verify queue, verify, approvals) and `donationProofs` (content check, ClamAV scan, metadata strip, hash flag).
  - Controls: `reconciliation`, `cashControls` (dual control, daily cash count, alerts), `reauth` (password + MFA, one-time grant) and `captcha` (optional, local).
  - `claimSettings`, the settings used by these services.
- **Backend utilities:** `money` (integer centavos), `reference` (normalize and mask), `signedLinks` and `sessionCookies`.
- **Backend config:** `config/donationClaims.js`.
- **Backend controller:** `controllers/donationClaimController.js`.
- **Backend scripts and tests:** `scripts/mapLegacyPayments.js` and `backend/test/*.test.js` (`npm test`).
- **Frontend pages and components:**
  - Pages: the new `Donate.jsx` and `DonorHistory.jsx`, and `ChangeTemporaryPassword.jsx`.
  - Donations tabs: To verify, Reconciliation and Cash count.
  - The Donor report panel and second-person check on the donation page.
  - Settings > Payment QR, including re-authentication, the change editor with QR check, approvals, version history, problem reports, the printable QR sheet and the donation controls.
- **Database:** `037_qr_donations.sql` and `rollback/037_qr_donations_rollback.sql`.

## Changed
- **Backend:**
  - `server.js`
  - `scripts/migrate.js`
  - `package.json`
  - `.env.example`
  - `config/notificationEvents.js`
  - `config/staffDuties.js` (new duty: Donations: cash verification)
  - controllers: auth, donation, donor, donorRecord, settings, user
  - middleware: auth (cookies + CSRF, forced password change), errorHandler, rateLimit
  - models: donation, settings
  - `routes/index.js`
  - services: donationLifecycle, donationService, mfaService, notifications, pdfService, unlockService
  - `utils/files.js`
- **Frontend:**
  - `App.jsx`
  - `api/client.js` (cookie session, no token storage, signed links)
  - `context/AuthContext.jsx`
  - `lib/duties.js`
  - `components/DonationForm.jsx`
  - pages: Donate, DonationDetail, Donations, DonorHistory, Legal (Terms and Privacy), Settings
- **Database:** `003`, `008`, `012` and `016`. Their ENUM lists now include every later value, so re-running all migrations can never narrow a list.
- **Docs:** `SECURITY-NOTES.md`, which gained a code-audit section.

## Database
- **Migration:** `database/037_qr_donations.sql` (runs with `npm run migrate`, safe to repeat).
- **Rollback:** `database/rollback/037_qr_donations_rollback.sql`. It drops only what 037 added, so donor reports made afterwards lose their claim fields. Restoring the backup is the cleaner undo.
- **Legacy mapping:** `npm run map-legacy-payments` is a dry run. It lists every legacy row and writes `legacy-payment-mapping.csv`. Then `-- --apply`.

| Old status | New status | Counted in totals? |
|---|---|---|
| Gateway paid | Verified | Yes |
| Gateway pending, failed, cancelled or expired | Cancelled (legacy) | No (hidden from donors) |
| Bank transfer waiting | Reported, in To verify | No |
| Bank transfer confirmed | Verified | Yes |
| Bank transfer rejected | Not matched | No |

## Secrets to rotate
None were found in the delivered code: it was searched for `sk_`, `pk_` and `whsk_`. I can't see your own `backend/.env`, git history or server logs. If PayMongo keys were ever in a commit, a shared zip or a log, revoke them in the PayMongo dashboard.

## Assumptions
- Staff need both Donations and the new "Donations: cash verification" duty to verify and reconcile. Admin always can. The duty is off by default.
- Saving the donation controls in Settings needs re-authentication when a value really changes. This stops one Admin from switching off the second-Admin rule alone. QR instructions change only through a change request.
- A statement date may be the day the money was sent or up to 3 days later.
- There is no visitor QR pass and no email reset link in CareSphere. Notes on what any future one must do are in SECURITY-NOTES.md §5 and §8.
- Admins need two-step verification set up to re-authenticate.

## Not run here
- **npm audit:** no registry access in this workspace. Run it in `backend/` and `frontend/`.
- **A real MariaDB:** the tests ran on a SQLite copy of the real schema, so the triggers, the generated column and the unique index are untested on MariaDB. Watch `npm run migrate` for errors.
- **The real jsQR and pdfkit libraries:** only stand-ins ran here.
