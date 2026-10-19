# CareSphere: protection of sensitive screens

This note covers how CareSphere protects child, health, transition, adoption, donor, account and audit
records on screen, what it can and cannot do, and how it was tested. It is written for the capstone
documentation. Wording is deliberate: **a web page cannot block operating-system screenshots, screen
recording, screen sharing or a phone camera.** The browser layers below *deter and record*; they don't
prevent. Where a layer works only on some devices, that is said.

Status: browser layer (Part B) built. Protected desktop and Android apps, registered devices and the
"where protected data may be opened" policy (Parts C and D) are the next update.

---

## 1. Diagnosis before the change (Part A)

Why protection seemed to work for some staff and not others: it depended on the **device and browser**,
not the account. Capture was detected only from keys the browser receives. Phones and tablets send none;
macOS screenshot keys (Cmd+Shift+3/4/5), the Windows Snipping Tool (Win+Shift+S), Xbox Game Bar, and Print
Screen when Windows 11 maps it to the Snipping Tool never reach the browser. The only account-based
condition was the Admin exemption (the home's Admin screenshot policy). Duties, settings and unlock state
did not change protection.

| Screen or file | Guard | Capture detection (Staff) | Print hidden | Copy / right-click blocked | Watermark | Gap found |
|---|---|---|---|---|---|---|
| Children list, child page (health, case files, CDCLAA) | Yes | Keys on Windows only | Yes | Yes | No | Child photos cached 5 minutes |
| Adoption list and detail | Yes | Keys on Windows only | Yes | Yes | No | |
| Adoption documents | **No** (new tab) | None | No (browser PDF viewer prints) | No | Staff: added by server; Admin: none | Save button in browser viewer |
| Protected records (embedded viewer) | Page only | None while the viewer has focus | No | No | Staff: added by server | Viewer toolbar |
| Bank-transfer proof | **No** (new tab) | None | No | No | None | |
| Transition list and detail | Yes | Keys on Windows only | Yes | Yes | No | |
| Donations, Visitors, Users, Audit log, Data protection | Yes | Keys on Windows only | Yes | Yes | No | |
| Donor pages (Donate, history, application) | Yes | Keys on Windows only | Yes | Yes | No | |
| Adopt a Child, My applications (donor) | **No** | None | No | No | No | |
| Dashboard, Notifications | No | None | No | No | No | References and counts only |
| Audit export, compliance report, receipts | Downloads, Admin only, logged | | | | No | Files leave the system by design |
| Any page on a phone or tablet | As desktop | **None** | Yes | Yes | No | |
| Any page, Admin | Yes | Off (policy) | Yes | Yes | No | Admin screenshot policy |

Also found: listeners attached just after the first paint (a split-second window), and copy was allowed in
editable form fields (on purpose, for typing).

## 2. What the browser layer does now (Part B)

One guard, `frontend/src/components/ProtectedContent.jsx`, wraps every signed-in page (from `Layout.jsx`) and
every document opened from them, so Staff and Donors get the same layers on every page. No screen has its own copy. `ProtectedArea.jsx` only re-exports it.

| Layer | What it does | Limits |
|---|---|---|
| Render gate | Nothing inside the guard renders until its listeners are attached. | |
| Watermark | Not used (the home's decision). | A photo or screenshot carries no on-screen mark of who took it; the audit log of who opened the record is the trace. |
| Hide when not active | Content is covered while the window is not focused or the tab/app is hidden. It shows again when the window is active. | The capture tool may already have taken its picture when it opened. |
| Capture keys | Print Screen (Windows sends it on key release), Cmd/Win+Shift+S/3/4/5, Ctrl/Cmd+P, Ctrl/Cmd+S and print events cover the content with "Screenshot or screen capture is not allowed for protected data." and log the attempt. | Only keys the browser receives. Print Screen arrives after the image is taken. |
| Print stylesheet | Printing shows only "Printing protected data is not allowed." | |
| No selection, copy, right-click, drag | Blocked on protected content and logged. Typing in form fields still works. | Developer tools can still read the page. |
| Documents | PDFs and photos are drawn as pages on canvases in a dialog (pdf.js). No browser PDF viewer, toolbar, Save or Print button, new tab or file URL. Files are fetched with the sign-in token, `Cache-Control: no-store`, and kept only in memory. Download stays a separate button, only where the server already allows it. | |
| Logging | Every capture, print and copy event: user, role, page, and browser/OS/device (from the request's User-Agent). Denied access is logged as before. | The User-Agent can be changed, so it is a label, not proof. |

Files are not served through signed links because the browser never receives a file URL at all: every file
request carries the user's session token in a header and the response is never cached. Child photos are
now `no-store` too.

Admin: by the Admin screenshot policy, Admin has no hiding and no capture message. The render
gate, print stylesheet, copy blocking, role and duty checks, download permissions and audit logging apply
to Admin as to everyone. This is the only account-based difference.

## 3. Test matrix (Part E)

Accounts to use: at least two Staff accounts with different duties (for example Staff A: Child records +
Health; Staff B: Adoption + Donations), and one Donor.

Result codes: **Blocked** (the capture does not contain the data), **Hidden** (the page hides the data, but
only after the action started, so the capture may contain it), **Logged** (an entry appears in Audit log >
Screenshot, print or copy attempts), **Not stopped**.

"Expected" is what the design does. Fill in "Observed" on each real device; don't record a result you did
not see.

| Action | Expected in a browser (Staff/Donor) | Windows Chrome | Windows Edge | Windows Firefox | macOS Safari | macOS Chrome | Android Chrome | iPhone Safari | Desktop app (next update) | Android app (next update) |
|---|---|---|---|---|---|---|---|---|---|---|
| Print Screen key | Not stopped; Hidden + Logged after the key, if the browser receives it | | | | n/a | n/a | n/a | n/a | | |
| Win+Shift+S / Snipping Tool | Not stopped; Hidden while the tool has focus; not Logged | | | | n/a | n/a | n/a | n/a | | |
| Xbox Game Bar recording | Not stopped; Hidden while the overlay has focus | | | | n/a | n/a | n/a | n/a | | |
| macOS Cmd+Shift+3 / 4 | Not stopped; not detected | n/a | n/a | n/a | | | n/a | n/a | | |
| macOS Cmd+Shift+5 / recording | Not stopped; Hidden while the toolbar has focus | n/a | n/a | n/a | | | n/a | n/a | | |
| Phone screenshot buttons | Not stopped; not detected | n/a | n/a | n/a | n/a | n/a | | | | |
| Phone screen recorder | Not stopped; Hidden only while another app is in front | n/a | n/a | n/a | n/a | n/a | | | | |
| Screen sharing (Meet, Teams, Zoom) | Not stopped; Hidden while the call window has focus | | | | | | | | | |
| Printing (Ctrl/Cmd+P or menu) | Blocked (prints a notice) + Logged | | | | | | | | | |
| Save page (Ctrl/Cmd+S) | Shortcut Blocked + Logged; browser menu Save not stopped | | | | | | n/a | n/a | | |
| Copy, right-click, drag | Blocked + Logged | | | | | | | | | |
| Open a document | Shown as pages; no Save/Print toolbar | | | | | | | | | |
| Photo of the screen with another phone | Not stopped | | | | | | | | | |

## 4. What still cannot be prevented, and what reduces the risk

| Cannot be prevented in a browser | Controls that reduce the risk |
|---|---|
| A photo of the screen with another camera | Need-to-know access (assignment, duties); short 3-minute unlock; Purpose step; audit log of every view |
| OS screenshots and screen recording (all platforms) | Same as above; hiding when the window is not active; logging what the browser can see. The protected desktop and Android apps (next update) can block capture of their own window |
| Screen sharing in video calls | Hiding when the call window has focus; confidentiality undertaking; policy and training |
| Developer tools (reading the page, network or memory) | Server-side checks on every request; no file URLs; no-store; restrict staff computers (no admin rights) |
| A staff member reading data aloud or copying by hand | Need-to-know assignment, Purpose step, audit log review, the confidentiality undertaking (RA 11642, RA 10173 obligations) |
| iPhone screenshots | Cannot be blocked on iOS at all; a native app could only detect them after the fact |

---

# Code audit: every kind of code in CareSphere (QR donations release, October 2026)

This section covers the QR-donation prompt (Parts E and F). Each code type has one table with the same rows: purpose, generation, storage, lifetime, single use, binding, rate limit and lockout, enumeration, logging, revocation, the loophole found, the fix, and the negative tests.

Test files:
- **Unit:** `backend/test/*.test.js`. Run with `npm test`.
- **Integration (test stack):** `qrtests.cjs` and `legacytest.cjs`. The checks they run are listed in the release report.

## 1. Receipt verification codes and acknowledgment numbers

| | |
|---|---|
| Purpose | Prove that a printed acknowledgment is genuine (Donations > Verify receipt). |
| Generation | `CSR-` plus 30 hex characters from `crypto.randomBytes(15)` (120 bits), then `.` plus a 16-character HMAC-SHA256 tag keyed with `RECEIPT_KEY`. The acknowledgment number `ACK-YYYY-NNNN` is sequential and separate. It is printed for filing and is never accepted as proof. |
| Storage | `tbl_donations.qr_receipt_code`. It is a printed value that must be checked, so it is not secret from the person holding the paper. |
| Lifetime | As long as the donation stands. Voiding invalidates it at once. |
| Single use | No. A receipt can be checked again. |
| Bound to | One donation. The HMAC tag stops anyone making codes up offline. |
| Rate limits | 10 per minute per IP and 120 per minute globally. A growing delay applies after repeated failures from one IP. Staff with the Donations duty or Admin only. |
| Enumeration | The format and HMAC are checked with constant-time comparison before any lookup. Unknown, voided and not-yet-acknowledged codes get the same "Code not found" answer. |
| Logging | Only the masked code (last 4). |
| Revocation | Voiding. Reissuing keeps the code, and the new PDF says it was reissued. |
| Loophole found | The receipt PDF was served by donation number (`/donations/:id/receipt`). The PDF title contained the code. A receipt could exist before the donation was verified. |
| Fix | Receipts are served only through a signed link (§7). The code was removed from the PDF title. An acknowledgment needs claim status Verified (or a staff-recorded gift), dual control Approved, and an allocation. |
| Negative tests | Unknown, voided and unacknowledged codes all return the same 404. The 11th check in a minute gets 429. A donor can't get another donor's receipt link. No receipt for a report, or for cash waiting for dual control (`receipts.test.js`, qrtests "Receipt ..."). |

## 2. Sequential numbers (donation, donor, application, case, visit, acknowledgment)

| | |
|---|---|
| Purpose | Human references (DNT-2026-0003, ACK-2026-0001 and so on). |
| Generation | Sequential, inside the inserting transaction. Acknowledgment numbers are taken under a row lock, so two acknowledgments can't get the same number (unique index `uq_ack_no`). |
| Storage | Plain. They are not secrets. |
| Bound to | Nothing: they are labels. |
| Enumeration | Every endpoint authorizes by role, duty and ownership: `load(req)`, `lockOwn`, and the assignment checks. Public and QR links use random IDs (`public_id`), never sequential numbers. |
| Loophole found | None new. Retired endpoints (`/payments/:id/proof`, `/donations/:id/documents/:docId`) fetched files by number. |
| Fix | Those endpoints were removed. Files are reached only through signed links. |
| Negative tests | A donor can't see another donor's report. Donors can't call staff document or receipt links (403). A wrong or other donor's ID returns the same 404. |

## 3. Staff unlock Token IDs and the token QR (Health, Adoption and Transition passes)

| | |
|---|---|
| Purpose | A second check before a staff member opens a sensitive record. |
| Generation | `crypto.randomInt`, short so it can be typed by hand. The challenge has a random `public_id`. |
| Storage | `token_hash` is SHA-256 keyed with a server pepper (HKDF of the server secret), so a database copy alone can't be brute-forced. An encrypted copy (`token_enc`) is kept only so the same QR can be shown again during its 60 seconds. |
| Lifetime | 60 seconds to type it (server clock). The unlock session that follows lasts 180 seconds. |
| Single use | Yes. `used_at` is set on success, and a new request replaces the open one. |
| Bound to | Staff user, session `jti`, record type and ID, and purpose. `sessionFor` re-checks the assignment on every use. |
| Rate limits | Token limiter per user. 5 failures in 15 minutes lock the user out. |
| Enumeration | One message for wrong, expired, other-session and other-record tokens. |
| Logging | Events are written to `tbl_unlock_events` without the typed value. |
| Revocation | Logout, deactivation (`tokens_valid_after`), duty removal and assignment change end unlock sessions. |
| Loophole found | The unlock session survived an assignment change. |
| Fix | `sessionFor` re-checks the assignment, and duty removal deletes the user's unlock sessions. |
| Negative tests | Guessing locks the user out (429 after 5). Wrong IDs never reach the log. Replay after use fails. A token from another session fails. Access ends after unassignment. |

The QR shows only the record type, the token and the time it is valid until. It has no personal data.

## 4. MFA (TOTP and backup codes)

| | |
|---|---|
| Purpose | Second factor for Admin sign-in and for re-authentication. |
| Generation | 160-bit TOTP secret (RFC 6238, 30-second step, ±1 step). 10 backup codes `XXXX-XXXX` from `crypto.randomInt`. |
| Storage | The secret is encrypted with AES-256-GCM (`MFA_ENCRYPTION_KEY`). Backup codes are stored as keyed hashes. |
| Single use | Yes. `mfa_last_step` blocks reuse of a step that was already accepted (replay). Each backup code has `used_at`. |
| Rate limits | 5 wrong codes per sign-in challenge. `verifyStepUp` locks after 5 failures in 15 minutes. `mfaLimiter` limits per IP. |
| Enumeration | The same message whether the password or the code was wrong. |
| Logging | Failures are logged without the code. |
| Revocation | Admin reset by another Admin, with their own code. Nobody can reset their own. |
| Loophole found | Step-up checks (used by re-authentication) had no lockout of their own. |
| Fix | Step-up checks now lock after 5 failures in 15 minutes. |
| Negative tests | The same code twice is refused (replay). Wrong codes give 401, then 429. A re-authentication grant is single-use, bound to user, session and purpose, and expires after 300 seconds (`mfa.test.js`, `reauth.test.js`, qrtests). |

## 5. Password reset, account activation and email verification tokens

CareSphere has **no** self-service reset, activation or email-verification links. There is no email sender. Admin sets a temporary password instead (§9), and Admin MFA reset is described in §4. Nothing exists here that could leak or be replayed. If such links are added later, they must use 32 random bytes, store only the SHA-256 hash, last at most 30 minutes, be single-use, be invalidated by a password change (`tokens_valid_after`), and always answer "If the account exists, we sent a link".

## 6. Sessions and CSRF

| | |
|---|---|
| Purpose | The signed-in session. |
| Generation | HS256 JWT with a random `jti` and the expiry from `JWT_EXPIRES_IN` (8 hours by default), plus an idle timeout. |
| Storage | Cookie `cs_session`: HttpOnly, SameSite=Strict, Path=/api, and Secure under HTTPS or when `COOKIE_SECURE=true`. Nothing is kept in localStorage or sessionStorage. |
| CSRF | Double submit. Cookie `cs_csrf` = HMAC(jti), sent back in the `X-CSRF-Token` header and checked on every state change. SameSite=Strict also applies. |
| Rotation | A new session on login, password change (all others revoked through `tokens_valid_after`) and role change. |
| Revocation | Logout adds the `jti` to `tbl_revoked_tokens` and clears the cookies. Deactivation sets `tokens_valid_after`. |
| Loophole found | The token was kept in web storage, readable by any script injected into the page. |
| Fix | Cookie sessions with CSRF. The Bearer header is still accepted for API clients and is not affected by CSRF. |
| Negative tests | A cookie request without the CSRF header gets 403. Logout ends the session. After a password change the old session is refused. Nothing is in web storage after sign-in (`sessions.test.js`, homefunc). |

## 7. Signed file links

| | |
|---|---|
| Purpose | The only way to fetch donation documents, proofs, QR images and acknowledgments. |
| Generation | `kind.id.user.exp.sig`, where sig is HMAC-SHA256 with `FILE_LINK_KEY`, compared in constant time. |
| Lifetime | 120 seconds. |
| Bound to | Kind, file ID and the signed-in user. The record's own permission check runs again when the file is served. |
| Path traversal | The link carries an ID, never a path. Storage keys come from the database, and files have random names. |
| Rate limits | `fileLimiter`. |
| Enumeration | An expired, forged or other user's link gets the same "This link has expired" answer. |
| Negative tests | Another user's link, a changed ID, an expired link and a bad signature all fail (`signedLinks.test.js`, qrtests). |

## 8. QR codes

- **Payment QRs:** the home's own merchant QR. Only images stored by CareSphere are served, through signed links (no hotlinks, no third-party generators). Each upload is decoded on the server and re-encoded (metadata removed). A QR that can't be decoded or contains a URL is refused, and a bad QR Ph CRC is refused. A changed name is warned about and must be confirmed. Changes need re-authentication, a reason and a second Admin (when there are 2+), and all Admins are notified. Versions are immutable: database triggers block update and delete, and old images are kept. Donors see "Updated on". Donors can report a problem with a QR. The donation controls in Settings (limits, the second-Admin switch and segregation of duties) also need re-authentication when a value really changes, so one Admin can't quietly switch the second-Admin rule off.
- **Unlock passes:** see §3.
- **Protected-record and child QR links:** carry only a random `public_id` or the child's reference. Opening one still needs sign-in and authorization.
- **Reception Visitor Pass:** the visitor log is manual and there is **no** visitor QR pass. Nothing a visitor carries can unlock a token pass. If a visitor pass is added later, it must be a separate kind with no personal data, one visit, a same-day expiry, and no link to the unlock flow.

## 9. Temporary passwords

| | |
|---|---|
| Purpose | A first password set by Admin, or a password reset by Admin. |
| Rules | `must_change_password` is set and expires after 72 hours (`temp_password_expires_at`). Until it is changed, only `/auth/me`, `/auth/password` and `/auth/logout` work. An expired temporary password can't sign in. |
| Loophole found | An Admin-set password could be used forever. |
| Fix | Forced change, expiry, and a new session after the change. |
| Negative tests | Other routes are refused before the change, and the expired temporary password fails (`sessions.test.js`). |

## 10. Secrets

- No real values are in the repository. `.env.example` has placeholders only. PayMongo keys and `PUBLIC_APP_URL` were removed, and `COOKIE_SECURE` and `FILE_LINK_KEY` were added.
- The error handler never logs request bodies, and references are masked to the last 4 characters.
- The delivered code was searched for `sk_`, `pk_` and `whsk_`, and none were found.
- Rotate the PayMongo secret and webhook keys if they were ever in your own `.env`, git history or server logs.

## 11. Donor-entered references and notes

| | |
|---|---|
| Rules | Reference: 4 to 40 letters and digits once normalized (trim, upper case, spaces and dashes removed). Note: up to 500 characters. Sender hint: a name or exactly 4 digits. All are parameterized in SQL and rendered as React text (never as HTML). |
| Uniqueness | The generated column `ref_key = method:reference` has the unique index `uq_donation_ref_key`, so two transactions can't both insert the same reference. A duplicate gets a generic message that names no donor. |
| Logging | References are masked to `****1234`. |
| Negative tests | A duplicate is refused even with 6 parallel requests. Dashes or spaces don't get around it. Injected HTML is shown as text. |

## 12. General sweep

| Area | Result |
|---|---|
| SQL injection | Every query is parameterized. Dynamic column lists come from fixed whitelists. |
| XSS and CSP | React escapes output. helmet sets a CSP (`default-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`). The printable QR sheet uses no inline script. |
| CSRF | §6. |
| Authorization | Central `authorize`, `requireDuty` and per-record loaders. The new routes are behind `OPS` + `D_DONATIONS`, `ADMIN`, `DONOR` and `canVerify` (cash verification duty). |
| IDOR | Tests for reports, proofs, documents, receipts, QR images and reconciliation lines. |
| Rate limits | Reports: per donor (10 per minute, a daily limit and an open-report cap), per IP per hour, and a burst alert. Also limited: re-authentication, MFA, files, receipt checks and QR problem reports. |
| Uploads | Proofs and QR images are checked by content signature and size, scanned by ClamAV when it is installed, stripped of metadata by re-encoding, given random names and encrypted at rest. Duplicate proofs are flagged by hash. |
| Errors | A generic 500 message with no stack trace. Denied and unknown records get the same answers. |
| Headers | HSTS, `Referrer-Policy: no-referrer`, Permissions-Policy and nosniff. |
| CORS | The configured origin only, with credentials. The allowed headers are `X-CSRF-Token` and `X-Reauth`. |
| Races | Verify, approve, withdraw, cash confirm, reconciliation convert and acknowledgment run in one transaction with `SELECT ... FOR UPDATE`. Money is integer centavos in code and DECIMAL(12,2) in the database. |
| npm audit | **Not run here** (no registry access in this workspace). Run `npm audit` in `backend/` and `frontend/` before release. |
