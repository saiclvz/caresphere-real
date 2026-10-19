/**
 * QR donations: the donor sends money OUTSIDE CareSphere (their own e-wallet or bank app, scanning the home's QR) and
 * reports it here; the home checks its own account and verifies. CareSphere never receives, holds or processes money.
 *
 * A donor report is a donation with status 'Pending verification' and a claim_status:
 *   Reported -> (Details requested -> Reported) -> Verified            (counted from here, with the verified amount)
 *            -> Awaiting approval (amount differs, or above the segregation-of-duties threshold) -> Verified
 *            -> Not matched (reason sent to the donor; not counted)
 *            -> Withdrawn (by the donor, while still open; not counted; the reference can be used again)
 * Legacy cancelled: an old online-gateway payment that failed, was cancelled or never finished (shown as "Cancelled (legacy)").
 *
 * Limits come from Settings (tbl_settings); these are the defaults used when a setting is missing.
 */
const CLAIM_STATUSES = ['Reported', 'Details requested', 'Awaiting approval', 'Verified', 'Not matched', 'Withdrawn', 'Legacy cancelled'];
/** Still waiting for the home (never counted). */
const OPEN = ['Reported', 'Details requested', 'Awaiting approval'];

/** What the donor sees (never internal notes). */
const DONOR_LABELS = {
  Reported: 'Waiting for the home to confirm',
  'Details requested': 'The home needs more details',
  'Awaiting approval': 'Waiting for the home to confirm',
  Verified: 'Confirmed by the home',
  'Not matched': 'Not matched yet',
  Withdrawn: 'Withdrawn',
  'Legacy cancelled': 'Cancelled (legacy)',
};
/** What Staff and Admin see. */
const STAFF_LABELS = {
  Reported: 'Reported by donor', 'Details requested': 'Details requested', 'Awaiting approval': 'Awaiting approval', Verified: 'Verified',
  'Not matched': 'Not matched', Withdrawn: 'Withdrawn by donor', 'Legacy cancelled': 'Cancelled (legacy)',
};

const SETTINGS = {
  donation_claim_max_amount: { def: 100000, min: 1, max: 10000000, label: 'Largest amount a donor can report (PHP)' },
  donation_claim_max_age_days: { def: 60, min: 1, max: 60, label: 'Oldest transfer a donor can report (days)' },
  donation_claim_max_pending: { def: 3, min: 1, max: 50, label: 'Open reports per donor' },
  donation_claim_daily_limit: { def: 5, min: 1, max: 100, label: 'Reports per donor per day' },
  donation_claim_ip_hourly_limit: { def: 20, min: 1, max: 1000, label: 'Reports per network address per hour' },
  donation_claim_burst_alert: { def: 10, min: 2, max: 1000, label: 'Alert Admin when this many reports arrive within 10 minutes' },
  donation_claim_captcha: { def: 0, min: 0, max: 1, label: 'Ask donors to answer a short check before reporting (1 = on)' },
  donation_duplicate_window_minutes: { def: 10, min: 1, max: 1440, label: 'Same amount and method again within (minutes) is treated as a double submit' },
  donation_stale_days: { def: 14, min: 1, max: 365, label: 'Flag open reports as Stale after (days)' },
  donation_sod_enabled: { def: 1, min: 0, max: 1, label: 'Segregation of duties (1 = on)' },
  donation_sod_threshold: { def: 10000, min: 0, max: 10000000, label: 'Second verifier needed above (PHP)' },
  cash_dual_control_threshold: { def: 5000, min: 0, max: 10000000, label: 'Cash and walk-in: a second person confirms above (PHP)' },
  payment_qr_second_admin: { def: 1, min: 0, max: 1, label: 'Payment QR changes need a second Admin when there are two or more (1 = on)' },
};
const SETTING_KEYS = Object.keys(SETTINGS);

/** The privacy consent the donor ticks (RA 10173); the version is stored with the report. */
const CONSENT_VERSION = 'donation-report-2026-10';

const QR_PROBLEMS = {
  name_mismatch: 'The name in my app is different', does_not_scan: "The QR code doesn't scan", wrong_details: 'The account details look wrong',
  looks_altered: 'The QR looks altered or replaced', other: 'Something else',
};

/** Statement lines and donor reports are compared on these. */
const MATCH_DATE_TOLERANCE_DAYS = 3;

module.exports = { CLAIM_STATUSES, OPEN, DONOR_LABELS, STAFF_LABELS, SETTINGS, SETTING_KEYS, CONSENT_VERSION, QR_PROBLEMS, MATCH_DATE_TOLERANCE_DAYS };
