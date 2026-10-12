# CareSphere: automatic ID scanning (front and back)

Adoption application, page 3 (Identity documents). This note is for the capstone documentation and the
adviser. It covers what the scan does, what it cannot do, which checks are still manual, and the test
results.

**The system shows "Verified – real and valid" only for an ID with an official verification result.**
The automatic scan (photo quality, OCR, QR code, MRZ, formats, matching) never makes an ID "real" or
"valid", and never calls an ID fake. Today the only official result CareSphere can record is a PhilSys
Check done by authorized staff on the original card. Every other ID is "Manual verification required"
until a person verifies it, and a person's verification is shown as "Manually verified by [role] on
[date]", not as "real and valid".

---

## 1. Two separate results

| Result | Values | Where it comes from |
|---|---|---|
| Automated checks | Passed, Failed, Unable to read | The scan of the front and back (`tbl_verifications.auto_result`, per side in `tbl_id_scans`) |
| Authenticity | Verified – real and valid / Manual verification required (and the existing statuses) | An official verification (`official_*` columns) or a person's review |

Statuses reused from the earlier ID checker: Manual verification required, Flagged for review, ID type
mismatch, Unrecognized ID, Invalid ID number, Information mismatch, Expired, Invalid ID, Unable to verify,
Requires correction, Verified. Added: **Verification failed** (an official service answered with something
unexpected). Suspicious signs give **Flagged for review**, never "fake".

## 2. What happens

1. **Upload (donor, page 3).** Two slots, "Front of ID" and "Back of ID". The back is required for card IDs
   and optional for a passport (the "Back photo required" rule per ID type). The donor can take a photo
   with the camera (guide frame sized to the card, ISO ID-1 or passport page; only the framed area is
   kept) or choose a file. JPG, PNG or PDF, 10 MB; the server checks the file by its content. On plain-HTTP
   LAN addresses the browser blocks the live camera, so the button opens the phone's camera app instead.
2. **Instant hints in the browser** (too small, too dark, too bright, blurry, glare, PNG that looks like a
   screenshot). The donor can retake or use the photo anyway. The server repeats the same measurements and
   its result counts. Card cut off and wrong side need text reading, so they come from the server scan a
   few seconds later.
3. **Malware scan** before saving (ClamAV, when `CLAMSCAN_PATH` is set in `backend/.env`; without ClamAV,
   files are checked by content type and size only).
4. **Server scan**, in the background right after each upload (2–3 s per side; up to 8 s when the photo is
   sideways or upside down):
   - quality: resolution, brightness, blur (Laplacian variance), glare, orientation (EXIF and OCR retries at
     90/180/270°);
   - OCR on this server (tesseract.js in a separate process). **No ID image is sent to any outside
     service.** The OCR language file is downloaded once from the tesseract.js default location if
     `backend/ocr-data/eng.traineddata` is missing; that download contains no images. For a server with no
     internet, copy `eng.traineddata` into `backend/ocr-data` first;
   - ID type and side from printed words (per-type keywords), compared with the selected type (ID type
     mismatch / Unrecognized ID); card cut off (text touching the photo edge);
   - fields: full name, date of birth, ID number, address, date issued, expiry date;
   - machine-readable parts: PhilID / ePhilID QR code (JSON and the "PH1:" compressed format), passport MRZ
     (TD3 and TD1, with all check digits);
   - validation: required fields per side, number format per type, real dates, expiry (Valid, Expired,
     Unable to determine), front and back are different photos (perceptual hash), sides not swapped, QR or
     MRZ vs printed details;
   - comparison with the applicant's details (name, date of birth, ID number), ignoring case, spacing,
     accents, word order and a missing middle name. A difference gives Information mismatch and names the
     field (System value vs ID value; the ID number is masked);
   - review flags (flag only): duplicate image (file hash seen on another applicant's application), the
     same ID number on another applicant (salted HMAC of the number, never the plain number), possible
     screenshot or copy (no camera data and PNG or a screen-sized image), editing software in the photo's
     metadata, QR or MRZ that doesn't match the printed data, inconsistent dates, too many retakes.
5. **Results to the donor**: a checklist with an icon and a word for each item (ID type matches, front
   readable, back readable, number format, name matches, date of birth matches, not expired, QR or MRZ read),
   and one message: "Your ID was scanned and the checks passed. Our team will confirm it.", "Your ID needs a
   fix." with the reasons and "Retake this side", or "We couldn't read this side. Please try again in good
   light." The donor sees what was read but cannot edit it, and sees only the last 4 characters of the ID
   number. Up to 5 retakes per side (6 uploads); after that the upload is refused and the ID goes to manual
   review. After submitting, the donor can still retake ID photos while the ID is not Verified.
6. **Staff and Admin review** (Adoption duty, assignment and unlocked sensitive sections, as before): both
   photos side by side in the protected viewer (drawn on canvases, no download, no file URL), the entered
   values next to what was read, each check per side with the photo measurements, the flags, the official
   verification block (source, result, reference, time, who), and Verify / Reject (reason required) /
   Request correction (message to the donor) / Flag for review. The completion gate is unchanged: the
   application cannot advance while the ID is not Verified.

## 3. ID types and adapters

The rules are in `tbl_id_type_rules` and are edited by Admin in **Settings > ID types and scanning
rules** (no redeploy; changes apply within a minute). Fields: name, number format (regular expression),
example, expires, back required, required fields per side, front and back keywords, date formats, QR or
MRZ and its side, verification adapter, on/off. The ID type dropdown on page 3 and the "ID expiry date"
question follow this table.

| ID type | Back | QR / MRZ | Adapter | Official verification today |
|---|---|---|---|---|
| PhilSys National ID (PhilID / ePhilID) | Required | QR (back) | `philsys_check` | **Staff-confirmed PhilSys Check** (see 4) |
| Philippine passport | Optional | MRZ (front) | `mrz_consistency` | None. MRZ check digits = consistency only |
| LTO driver's license | Required | – | `manual` | None |
| UMID | Required | – | `manual` | None |
| PRC ID | Required | – | `manual` | None |
| Postal ID | Required | – | `manual` | None |
| Voter's ID | Required | – | `manual` | None |
| PhilHealth ID | Required | – | `manual` | None |

Adapter interface (`backend/src/services/verificationAdapters.js`): input = ID type and decoded data;
output = status (verified, not_verified, unable, failed, staff_step, none), source, reference, timestamp,
raw result (stored encrypted), mode (automatic / staff_confirmed). Adapter errors, timeouts or no internet
give Unable to verify or Verification failed, never Verified. To plug in an authorized service later, add it
to `backend/src/config/verificationProviders.js` (keys in `backend/.env`); it then appears in the adapter
list in Settings.

### Still manual, and why

- **Passport:** the DFA publishes no verification service for private systems. The MRZ check digits only
  show the printed data is internally consistent; a forged passport can have correct check digits.
- **Driver's license, UMID, PRC, Postal, Voter's, PhilHealth:** no official verification API is available
  to a private welfare home. Staff verify the original (Original document sighted and checked, Official QR
  code checked on the issuer's site, or Reference number confirmed with the issuing office).
- **PhilSys:** see below. The QR's digital signature is not checked by CareSphere (no published key or
  server method), so the server's QR reading is used for consistency only.

## 4. PSA / PhilSys: is there a server-usable verification?

**No, not for a private system like CareSphere (as of this build).** What the PSA publishes:

- **PhilSys Check** (verify.philsys.gov.ph) is a web page used in a browser or phone to scan the QR code on
  a PhilID or ePhilID. The QR code is signed with public-private key cryptography, and PhilSys Check checks
  that signature. No public server API or verification key is published.
- The BSP told banks to accept the PhilID and ePhilID and to authenticate them by scanning the QR with
  PhilSys Check (BSP Memorandum M-2022-044, as reported by the PSA).
- PhilSys online authentication services (for example eVerify) are offered to accredited relying parties
  and government agencies, not to the public.

**Fallback built:** the server decodes the QR for the consistency checks, and an authorized Staff member or
Admin uses **Verify with PhilSys Check**: they scan the QR on the original card at verify.philsys.gov.ph,
then record what it showed (Verified / Deactivated card / QR code could not be read), whether the displayed
details match the printed card, an optional reference and a note. It is stored as **Staff-confirmed**
(`official_mode = staff_confirmed`) with their name and the time, never as automatic.

| PhilSys Check showed | Details match | Status |
|---|---|---|
| Verified | Yes | Verified – real and valid (PhilSys Check, Staff-confirmed) |
| Verified | No (note required) | Information mismatch |
| Deactivated card | – | Invalid ID |
| QR code could not be read | – | Unable to verify |

Sources:
- [PSA: PSA unveils PhilSys Check, PhilID verification system](https://psa.gov.ph/content/psa-unveils-philsys-check-philid-verification-system)
- [PSA: PhilSys authentication services strengthen transaction security](https://psa.gov.ph/content/philsys-authentication-services-strengthen-transaction-security)
- [PNA via DepDev: Public-private key cryptography now available with PhilSys (April 2022)](https://governance.depdev.gov.ph/public-private-key-cryptography-now-available-with-philsys/)
- [PSA: PSA welcomes BSP issuance prioritizing acceptance of PhilID and ePhilID in financial transactions](https://psa.gov.ph/content/psa-welcomes-bsp-issuance-prioritizing-acceptance-philid-ephilid-financial-transactions)
- [PSA press release: Digital National ID, National ID eVerify and National ID Check](https://psa.gov.ph/system/files/philsys/Press%20Release%20Digital%20Natl%20ID%5ELJ%20Natl%20ID%20eVerify%5ELJ%20Natl%20ID%20Check%20_Rev1-signed.pdf)

Ask the adviser to confirm these before the defense; this can change.

## 5. Privacy, security, audit

- **Encryption:** ID photos stay encrypted on disk (as before). Extracted fields, decoded QR/MRZ fields and
  the official raw result are encrypted in the database (`encField`). The raw QR payload is never stored,
  only the decoded fields needed for the checks.
- **Retention:** Settings > Sensitive record access > "ID scan retention (days)" (default 90). That many
  days after an application is Closed, Declined or Withdrawn, the extracted fields of its scans are cleared
  (hourly job). **The ID photos, the scan results (pass/fail) and the audit log are kept**, per the rule
  that uploaded files and audit entries are never deleted. This is the one place where stored data is
  cleared, and only the copy the scan made.
- **ID photos replaced in a draft** are now kept and marked Replaced (they were deleted before), because
  the scan history refers to them.
- **Access:** donors see only their own scan and the last 4 characters of the number; staff need the
  Adoption duty, the assignment and unlocked sensitive sections; lists show no ID numbers. Files are fetched
  with the sign-in token in a header and `no-store`, so the browser never gets a file link (this replaces the
  "short-lived signed link" in the brief; there is no link to share at all). No watermark, per the home's
  decision.
- **Limits:** 10 MB, file type by content, malware scan (when ClamAV is installed), 20 uploads a minute,
  6 uploads per side, 60 scan-result requests a minute, 10 PhilSys Check records a minute.
- **Audit log** (Audit log > Sensitive record access > ID and clearance verification), with who, what, when
  and the result. No ID numbers or images are logged.

| Code | When |
|---|---|
| UPLOAD_ADOPTION_DOCUMENT (valid_id / valid_id_back) | Each ID photo upload |
| ID_SCAN (side, attempt n: result; flags) | Each scan result |
| ID_RETAKE_LIMIT (side) | A 7th upload of a side was refused |
| ID_AUTOMATIC_CHECK | Each status change from the checks, including the adapter call and its result |
| VIEW_ID_SCAN (applicant / role) | Scan results viewed |
| ID_PHILSYS_CHECK | PhilSys Check result recorded (Staff-confirmed) |
| ID_MANUAL_VERIFIED / _REJECTED / _CORRECTION_REQUESTED / _FLAGGED | A person's review |
| CREATE_ID_TYPE_RULE / UPDATE_ID_TYPE_RULE | Admin changed the ID type rules |
| MALWARE_BLOCKED (security log) | An upload refused by the malware scan |

- **Privacy notice** on page 3: what is read from the ID and why (RA 10173), that it stays on this server,
  is encrypted, and is cleared after the retention period.

**Question for the adviser:** does copying and storing images of government IDs (front and back) need
additional consent or limits beyond the application's privacy notice and declaration under RA 10173 (for
example a separate consent line for ID images, a shorter retention for the images themselves, or keeping
only the result after verification)? CareSphere currently keeps the images with the application, as with
every other uploaded document.

## 6. Tests (synthetic specimens only)

All test images were drawn by a script (`SPECIMEN` printed on each, fictional person "Ana Santos Dela Cruz",
fictional numbers, a fake QR signature). **No real ID was used.** OCR in these tests used the Tesseract
command-line engine (same LSTM model family as tesseract.js on the server); tesseract.js may differ
slightly.

### Scenarios

| Scenario | Expected | Result |
|---|---|---|
| PhilID front + back, all good | Passed; Manual verification required | Pass |
| Front only (back missing) | Back required; submit blocked | Pass |
| Wrong ID type selected (license uploaded as PhilID) | ID type mismatch | Pass |
| Blurry front | Unable to read | Pass |
| Glare | Failed (glare) | Pass |
| Too dark | Failed (too dark) | Pass |
| Card cut off | Failed (card not fully visible) | Pass |
| Upside-down photo | Read after rotation; Passed | Pass |
| Front and back swapped | Failed (swapped) | Pass |
| Same photo for both sides | Flagged for review | Pass |
| Expired passport | Expired | Pass |
| License number format wrong | Invalid ID number | Pass |
| Name and birth date differ from the application | Information mismatch, names both fields | Pass |
| QR code differs from the printed card | Information mismatch + flag | Pass |
| Passport MRZ check digit failure | Flagged for review (MRZ check failed) | Pass |
| Duplicate image | Flagged for review | Pass |
| ID number used by another applicant | Flagged for review | Pass |
| Screenshot instead of a photo | Flagged for review (not rejected) | Pass |
| More than 6 uploads of a side | Upload refused; flagged | Pass |
| Adapter offline (timeout / no internet) | Unable to verify, never Verified | Pass |
| Adapter unexpected answer | Verification failed | Pass |
| PhilID verified through PhilSys Check, details match | Verified – real and valid (Staff-confirmed) | Pass |
| PhilSys Check: details differ / deactivated / QR unreadable | Information mismatch / Invalid ID / Unable to verify | Pass |
| PhilSys Check on a passport, or on an expired ID | Refused | Pass |

Browser checks (Chromium): camera capture with a guide frame (fake camera), instant hints (dark, glare,
blurry, screenshot all flagged; a good photo uploads straight away), retake buttons and counts, checklist
with icon and word, read-only "what we read" with the masked number, phone width (390 px, no sideways
scroll), staff review with both photos in the viewer, PhilSys Check form, Admin ID type editor.

### OCR accuracy on the test set

| Field | Clear photos | Poor photos (dark, glare, blurry, cropped) |
|---|---|---|
| Full name | 9/9 | 2/4 |
| Date of birth | 9/9 | 2/4 |
| ID number | 9/9 | 2/4 |
| Address | 4/4 | 2/4 |
| Date issued | 5/5 | – |
| Expiry date | 5/5 | – |
| **All fields, clear photos** | **41/41 (100%)** | |

The poor photos that could not be read (glare, blurry) were rejected by the quality checks before OCR
mattered, which is the intended behaviour.

**This overstates real-world accuracy.** The specimens use one clean font on a plain background. Real cards
have guilloche backgrounds, holograms, small print and worn surfaces. Fields to treat as unreliable until
tested on consenting staff's own IDs (with permission, and not kept):

- **Address:** multi-line, abbreviations, often cut by the photo or the card layout. Never used for a
  pass/fail decision.
- **Names with Ñ, accents or particles** ("DE LA", "DELA"), and given vs middle name split on cards that
  print one combined line (driver's license). Name comparison ignores order and a missing middle name for
  this reason.
- **Digits that look like letters** (0/O, 1/I, 5/S, 8/B): corrected only where the field must be numeric;
  letter-number IDs (passport, license) can still be misread.
- **Dates** in mixed formats (DD/MM vs MM/DD on some cards).
- **MRZ:** the run of `<` characters is often miscounted by OCR; CareSphere realigns the line, and an
  unreadable check digit counts as "unclear", not as a failure.
- **QR codes** on worn or glossy cards, and the ePhilID printout at low resolution.

### Not built (and why)

- **Moiré and on-screen UI detection** for screenshots/re-photographed screens: not reliable without a
  trained model; screenshots are flagged from missing camera data, PNG format and screen-sized images only.
- **PhilID QR signature check on the server:** no published key or method (see 4).
- **Font-consistency analysis:** flagged only through editing-software metadata and QR/MRZ vs printed
  mismatches.

## 7. Files

Backend: `services/idScan/` (index, image, text, mrz, qr, ocr, ocrWorker), `services/idTypes.js`,
`services/verificationAdapters.js`, `services/malwareScan.js`, `services/verification.js`,
`controllers/adoptionController.js`, `controllers/idTypeController.js`, `controllers/settingsController.js`,
`models/settingsModel.js`, `config/adoptionForm.js`, `config/auditCategories.js`,
`config/verificationRules.js`, `services/adoptionValidation.js`, `routes/index.js`, `server.js`,
`package.json` (sharp, jsqr).

Frontend: `components/adoption/IdCapture.jsx` (new), `lib/imageHints.js` (new),
`components/IdTypesSettings.jsx` (new), `components/adoption/VerificationList.jsx`, `pages/AdoptionForm.jsx`,
`pages/MyApplicationDetail.jsx`, `pages/Settings.jsx`, `pages/adoption/formLogic.js`.

Database: `database/027_id_scanning.sql`, rollback `database/rollback/027_id_scanning_rollback.sql`.
