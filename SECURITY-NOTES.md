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
