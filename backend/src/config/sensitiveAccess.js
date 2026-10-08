/**
 * One configuration for the sensitive-record access flow (health, adoption applications,
 * Transition Review). Times are seconds, enforced on the server clock; the browser countdowns
 * only display them.
 */
const TOKEN_TYPING_WINDOW = 60; // the Token ID must be typed and verified within this time
const ACCESS_SESSION = 180;     // how long the data stays open after a successful verification
const WARNING_SECONDS = 30;     // the "about to lock" warning
const LOCKOUT_FAILURES = 5;     // failed verifications ...
const LOCKOUT_MINUTES = 15;     // ... within this many minutes lock the user out for this long

/** Record types (stored values). Adoption keeps its existing stored name. */
const RECORD_TYPES = ['health', 'adoption_application', 'transition_review'];

/** Purpose lists per record type ("Other" makes the note required). Validated on the server. */
const PURPOSES = {
  adoption_application: [
    'Review the application', 'Check submitted documents', 'Home study or interview preparation',
    'Follow up with the applicant', 'Match with a child', 'Court or legal process', 'Other',
  ],
  transition_review: [
    'Transition review', 'Exit planning', 'Education or skills assessment', 'Housing and aftercare planning', 'Update staff remarks', 'Other',
  ],
  // Health access keeps its existing options.
  health: ['Case review', 'Home study', 'Interview preparation', 'Court or legal process', 'Other'],
};

/**
 * Plain text inside the token QR, per record type. Only a title, the token, its expiry time and
 * instructions: never a name, reference or case number, or any record data. These are separate
 * from any reception or visitor QR text.
 */
const QR_TITLES = {
  health: 'CareSphere Health Pass',
  adoption_application: 'CareSphere Adoption Pass',
  transition_review: 'CareSphere Transition Pass',
};
const QR_FOOTERS = {
  health: "Type this Token ID on your computer. Don't share it. No personal or child/health data is stored in this code.",
  adoption_application: "Type this Token ID on your computer. Don't share it. No personal data is stored in this code.",
  transition_review: "Type this Token ID on your computer. Don't share it. No personal data is stored in this code.",
};

/** HH:MM:SS of a Date on the server's clock (local time). */
const hhmmss = (d) => [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');

function qrText(recordType, token, validUntil) {
  return `${QR_TITLES[recordType]}\nToken: ${token}\nValid until: ${hhmmss(validUntil)}\n${QR_FOOTERS[recordType]}`;
}

module.exports = {
  TOKEN_TYPING_WINDOW, ACCESS_SESSION, WARNING_SECONDS, LOCKOUT_FAILURES, LOCKOUT_MINUTES, RECORD_TYPES, PURPOSES, QR_TITLES, qrText, hhmmss,
};
