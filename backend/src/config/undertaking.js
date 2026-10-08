/**
 * Confidentiality undertaking: where it applies and the starting text for each area.
 *
 * Admin and Staff accept it the first time in each sign-in session that they open an area's records
 * (Adoption, Transition Review). SCOPE:
 *   'per_area' - each area needs its own acceptance (accepting Adoption doesn't cover Transition Review)
 *   'shared'   - one acceptance covers both areas (the Adoption text and version are shown)
 *
 * The texts below are only the first versions. From the first use on, each area's text lives in
 * tbl_undertaking_versions and Admin edits it in Data protection (every change is a new version).
 * Don't change this legal wording without the adviser's confirmation.
 */
const SCOPE = 'per_area';

const ADOPTION_PARAGRAPHS = [
  'Adoption records are strictly confidential under Section 39 of RA 11642 (Domestic Administrative Adoption and Alternative Child Care Act).',
  'I will access adoption records only when my work on a case requires it, and I will not copy, photograph, print, share or discuss them except as my duties and the law require.',
  'I will protect the personal data of applicants, children and birth families as required by the Data Privacy Act of 2012 (RA 10173), and I will report any suspected breach to the Data Protection Officer right away.',
  'I understand that my access is recorded, and that unauthorized disclosure can lead to administrative, civil and criminal liability.',
];

const AREAS = {
  adoption: {
    label: 'Adoption', records: 'adoption records', versionPrefix: 'CU',
    first: { version: 'CU-2026-1', title: 'Confidentiality undertaking', paragraphs: ADOPTION_PARAGRAPHS },
  },
  // Same wording as Adoption until the final Transition Review text is confirmed with the adviser.
  transition: {
    label: 'Transition Review', records: 'transition review records', versionPrefix: 'CU-TR',
    first: { version: 'CU-TR-2026-1', title: 'Confidentiality undertaking', paragraphs: ADOPTION_PARAGRAPHS },
  },
};

/** The stored area for an acceptance: the area itself, or "shared" when one acceptance covers both. */
const acceptanceArea = (area) => (SCOPE === 'shared' ? 'shared' : area);
/** The text shown for an area: under "shared", always the Adoption text. */
const textArea = (area) => (SCOPE === 'shared' ? 'adoption' : area);

module.exports = { SCOPE, AREAS, acceptanceArea, textArea };
