/**
 * Government ID and clearance checks. One place to adjust formats and rules.
 *
 * There is no official verification service connected to CareSphere (PhilSys authentication needs
 * accreditation; the NBI, PNP and courts offer no API for a private system). So the automatic checks
 * below only catch obvious problems. A person must verify every ID and clearance before it counts, and
 * nothing is ever marked verified automatically.
 *
 * format: a pattern for the ID number as printed (spaces ignored), or null when the format varies too much
 * to check safely. expires: whether the ID has an expiry date. Have your adviser confirm these patterns.
 */
const ID_TYPES = {
  'PhilSys National ID': { format: /^\d{4}-?\d{4}-?\d{4}-?\d{4}$/, example: '1234-5678-9012-3456 (PhilSys Card Number)', expires: false,
    keywords: ['PAMBANSANG PAGKAKAKILANLAN', 'PHILIPPINE IDENTIFICATION CARD', 'PHILSYS', 'PHILIPPINE STATISTICS AUTHORITY'] },
  Passport: { format: /^([A-Z]\d{7}[A-Z]|[A-Z]{2}\d{7})$/, example: 'P1234567A', expires: true,
    keywords: ['PASSPORT', 'PASAPORTE', 'DEPARTMENT OF FOREIGN AFFAIRS'] },
  "Driver's license": { format: /^[A-Z]\d{2}-?\d{2}-?\d{6}$/, example: 'N01-23-456789', expires: true,
    keywords: ["DRIVER'S LICENSE", 'DRIVERS LICENSE', 'LAND TRANSPORTATION OFFICE', 'NON-PROFESSIONAL', 'PROFESSIONAL DRIVER'] },
  UMID: { format: /^\d{4}-?\d{7}-?\d$/, example: '0111-1234567-8 (CRN)', expires: false,
    keywords: ['UNIFIED MULTI-PURPOSE', 'UMID', 'SOCIAL SECURITY SYSTEM', 'GSIS'] },
  'PRC ID': { format: /^\d{7}$/, example: '0123456 (registration number)', expires: true,
    keywords: ['PROFESSIONAL REGULATION COMMISSION'] },
  'Postal ID': { format: null, example: null, expires: true, keywords: ['POSTAL IDENTITY CARD', 'PHLPOST', 'PHILIPPINE POSTAL'] },
  "Voter's ID": { format: null, example: null, expires: false, keywords: ['COMMISSION ON ELECTIONS', 'COMELEC', "VOTER'S"] },
};

/** Text on other IDs, so an upload of the wrong card can be noticed (these are not accepted ID types). */
const OTHER_ID_KEYWORDS = { 'PhilHealth ID': ['PHILHEALTH', 'PHILIPPINE HEALTH INSURANCE'], 'TIN ID': ['BUREAU OF INTERNAL REVENUE'], 'Student ID': ['STUDENT'] };

/** Photo-editing software names that, found in an ID image's metadata, flag it for review (never "fake"). */
const EDITING_SOFTWARE = ['Adobe Photoshop', 'Photoshop', 'GIMP', 'Canva', 'PicsArt', 'Snapseed', 'Pixlr', 'Lightroom', 'Affinity Photo', 'Paint.NET', 'Fotor'];

/** Readings below this OCR confidence (0-100) are too unreliable to compare. */
const OCR_MIN_CONFIDENCE = 55;

/** Clearances NACC accepts, valid for one year from the date issued. */
const CLEARANCE_KINDS = ['NBI clearance', 'Police clearance', 'Court clearance'];
const CLEARANCE_VALID_MONTHS = 12;

/** How a person verified a record (shown in the history and the audit log). */
const VERIFY_METHODS = [
  'Original document sighted and checked',
  'Official QR code checked on the issuer\'s site',
  'Reference number confirmed with the issuing office',
];

/** Statuses. Only a person's review can set Verified. */
const ID_STATUSES = ['Pending verification', 'Manual verification required', 'Verified', 'Invalid ID', 'Expired', 'Information mismatch',
  'Invalid ID number', 'ID type mismatch', 'Unrecognized ID', 'Unable to verify', 'Flagged for review', 'Requires correction'];
const CLEARANCE_STATUSES = ['Pending verification', 'Manual verification required', 'Verified', 'Not verified', 'Expired', 'Invalid',
  'Verification failed', 'Requires correction', 'Flagged for review'];

module.exports = { OTHER_ID_KEYWORDS, EDITING_SOFTWARE, OCR_MIN_CONFIDENCE, ID_TYPES, CLEARANCE_KINDS, CLEARANCE_VALID_MONTHS, VERIFY_METHODS, ID_STATUSES, CLEARANCE_STATUSES };
