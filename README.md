# CareSphere

**A QR Code Integrated Web-Based Dashboard System for Child Registry and Welfare Home Operations Management**

CareSphere runs on a local network: a Node.js/Express REST API talks to a MySQL database (XAMPP), and a React (Vite + Tailwind) dashboard is served to browsers on the same LAN. It uses no cloud services or external APIs.

```
caresphere/
├── database/           SQL schema + reference data (roles, default settings)
├── backend/            Express API (MVC): config, middleware, models, controllers, services, routes
│   └── scripts/        gen-keys, migrate, create-admin
└── frontend/           React + Vite + Tailwind dashboard
```

---

## 1. Requirements

- **Node.js 18 or newer** (uses `node --watch` and native `crypto` AES-256-GCM)
- **XAMPP** with MySQL/MariaDB running (default `root` with no password works; set a password for real deployments)
- A modern browser (Chrome, Edge, Firefox). Camera QR scanning has extra requirements (see section 5).

---

## 2. First-time setup

### 2.1 Start MySQL
Open the XAMPP Control Panel and start **MySQL**. You do not need to create the database by hand, because the migration script does that.

### 2.2 Backend
```bash
cd backend
npm install
cp .env.example .env          # Windows: copy .env.example .env
npm run gen-keys              # prints JWT_SECRET, PHI_ENCRYPTION_KEY, QR_ENCRYPTION_KEY, RECEIPT_SIGNING_KEY
```
Paste the generated values into `backend/.env`, and adjust the `DB_*` settings if your MySQL is not the XAMPP default.

```bash
npm run migrate               # creates caresphere_db, all tables, roles and default settings
npm run create-admin          # interactive: name, email, password for the first Admin
npm run dev                   # API on http://localhost:5000  (use `npm start` in production)
```
Check that it is running by opening `http://localhost:5000/api/health`.

### 2.3 Frontend (development)
```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173  (proxies /api to :5000)
```

### 2.4 Frontend (single-server LAN deployment)
```bash
cd frontend
npm run build                 # outputs frontend/dist
cd ../backend
npm start
```
When `frontend/dist` exists, the Express server serves the built app itself. Then everything (UI + API) runs at `http://<server-ip>:5000`, and you do not need Vite or the CORS setup.

---

## 3. Accessing it from other devices on the LAN

1. Find the server PC's IPv4 address (`ipconfig` on Windows, `ip a` on Linux), e.g. `192.168.1.20`.
2. Allow ports **5000** (and **5173** if you use the dev server) through the firewall.
3. If you use the Vite dev server, add each origin to `CORS_ORIGINS` in `backend/.env`, comma-separated:
   ```
   CORS_ORIGINS=http://localhost:5173,http://192.168.1.20:5173
   ```
   Restart the backend after editing `.env`.
4. Browse to `http://192.168.1.20:5000` (built app) or `http://192.168.1.20:5173` (dev).

---

## 4. Roles and access

| Module / feature | Admin | Staff | Donor | Adoption Applicant |
|---|---|---|---|---|
| Full child record (health + case files) | Yes, after password re-check (3 min) | Yes, after typed token (3 min) | No | No |
| Child profile (non-sensitive) | Create, edit, delete | Edit (incl. discharged children) | No | No |
| Public child bio and photo | Yes | Yes | Yes (children marked public) | Yes (children marked public) |
| Discharge documentation | Yes | Yes | No | No |
| Adoption review | All statuses | Under Review, Additional Documents Required | No | Own applications only |
| Transition Review (18+) | Yes | Yes | No | No |
| Inventory and meals | Full CRUD | Full CRUD (meals: deactivate; permanent delete is Admin) | No | No |
| Visitors | Full | Check in, edit, time out | No | No |
| Donation submission | Record / confirm | Record / confirm | Submit (Pending) | Submit (Pending) |
| Users, settings, schedules, audit log | Yes | My schedule only | No | No |

- **Public registration** creates Donor or Adoption Applicant accounts only. Admins create Staff and Admin accounts.
- The first Admin is created with `npm run create-admin` (no default password). The last active Admin cannot be demoted, deactivated or deleted.
- Roles are re-read from the database on every request, so changes take effect immediately.

---

## 5. Token security policy

| Token | Lifetime | Purpose | Enforced by |
|---|---|---|---|
| Typed token (Token ID) | **60 seconds**, single use | Staff prove presence: the screen shows a QR, the phone camera shows the Token ID, Staff type it | `qrService.verifyToken` (MySQL clock) |
| Health access token | **180 seconds** | Opens one child's health record and case files for one user | `requireHealthAccess` middleware (MySQL clock) |

1. **Staff**: *Verify token* on a child's record → a Token ID QR is generated → scan it with the phone camera → type the 8-character Token ID within 60 s → the server exchanges it (once) for a 180-second health access token.
2. **Admin**: *Verify with password* → re-enter their password → 180-second health access token.
3. The token is bound to that user and that child and sent as the `X-Health-Access` header. After 180 s the API refuses it (`401`) and the page locks and clears the data. *Lock now* revokes it early.
4. Every issue, denial, view, update, expiry and revocation is written to `tbl_health_data_access_logs` (Audit log → *Health data access* tab) and summarised in the compliance report.

Only hashes of both token types are stored. The QR contains no names, record IDs or health data.

---

## 6. Children, discharge, adoption and transition rules

- **Age** is always computed from date of birth. Lists are sorted **youngest first**.
- **Registration age limit:** children older than **17** cannot be newly registered. The form disables *Register child* and shows *"Registration denied. The child exceeds the maximum age requirement."*; the API also rejects it with `422`. Existing records are never affected.
- **18+:** children who turn 18 are flagged automatically (at start-up, every 6 hours and whenever lists load) and appear under *Children Management → Transition Review (18+)* with statuses For Review / In Progress / Completed and housing, vocational and education goals. **They are never discharged or deleted automatically.**
- **Discharge:** changing an Active child to Discharged requires a reason, a report of what happened and a discharge date (blank or whitespace-only is rejected). *Reported by* is the signed-in user. Each discharge is kept permanently in `tbl_child_discharge_history`.
- **Status overrides:** only an Admin can change the status of a Discharged or Adopted child. Staff edits to a discharged child keep the Discharged status.
- **Adopted** is never set by hand. Approving an application does **not** change the child. Only when an Admin marks an Approved application **Completed** does the child become Adopted (other open applications for that child are closed automatically).
- **Deletion:** children with discharge or adoption records cannot be deleted; change their status instead.
- **Public profiles:** donors and applicants see only children an Admin has marked *Show on the donor and adoption portals*, and only first name + last initial, age, gender, photo, public bio and needs.

### Adoption application (6 sections)
Applicant information, family and household, child selection, supporting documents (PDF/PNG/JPG, max 10 MB each, with Submitted / Missing indicators; a government ID and a background check are required before approval), reason for adoption, and a declaration and privacy-consent checkbox (timestamped). Reviewers add notes and change statuses; the full timeline is kept in `tbl_adoption_reviews`.

---

## 7. Donations

Donors and applicants use **Donate**: select at least one child, choose a method and amount (in-kind donations describe the items), and give a **reason** (required). A review step shows everything before submission. The submit button locks while sending, and an `Idempotency-Key` header guarantees a double click cannot create two donations.

Donor-submitted donations are **Pending** until staff click *Mark received* (or *Cancel*). Receipts are issued only for received donations. CareSphere records donations; it does not process payments.

---

## 8. Search

The header search filters the current page: case-insensitive, 300 ms after typing stops (or immediately on Enter), and clearing it restores the full list at once. Lists search on the server through each module's own access-controlled endpoint (`?q=`), so search never reveals records a role cannot already see. Empty results show *"No matching records found."*

---

## 9. Data protection and files

- **Encrypted at rest (AES-256-GCM, `PHI_ENCRYPTION_KEY`):** health history, case files (background and care, guardian and family), child photos and adoption documents. Uploaded files are checked by their real content, stored under `backend/uploads/` with random names and only served through authorised routes.
- ⚠️ **Back up `PHI_ENCRYPTION_KEY` and the `backend/uploads/` folder.** Losing the key makes health data, photos and documents permanently unreadable. Never change the key after data exists.
- **Never commit `.env`.** The included `.gitignore` excludes `.env`, `node_modules/`, `backend/uploads/` and `frontend/dist/`.
- Passwords use bcrypt; sign-in sessions use JWT with a logout denylist; login, token and upload endpoints are rate-limited; Helmet headers and a CORS allow-list are enabled.

### Upgrading an existing database
Run `npm run migrate` again in `backend/`. Migration `003_v2_updates.sql` adds the new columns and tables without touching existing records (it uses MariaDB `IF NOT EXISTS` syntax, which XAMPP provides). Existing children get an empty admission date and are not shown on public portals until an Admin enables it.

### New tables
`tbl_child_discharge_history`, `tbl_transition_reviews`, `tbl_adoption_applications`, `tbl_adoption_documents`, `tbl_adoption_reviews`, `tbl_health_access_tokens`, `tbl_health_data_access_logs`, `tbl_donation_children`. The inventory `is_restricted` column and visitor `qr_pass_code` column were removed (no QR in those modules).

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing or invalid PHI_ENCRYPTION_KEY` on start | Run `npm run gen-keys` and paste all four values into `.env` (each key is 64 hex characters) |
| `ECONNREFUSED 127.0.0.1:3306` | MySQL is not running in XAMPP, or `DB_PORT` is wrong |
| `ER_ACCESS_DENIED_ERROR` | Check `DB_USER` / `DB_PASSWORD` |
| Browser shows a CORS error | Add the exact origin (scheme + IP + port) to `CORS_ORIGINS` and restart the API |
| Camera will not start (receipt verification) | Use HTTPS or `localhost`, or use *Scan a photo* / *Enter code* |
| "Token expired" right after scanning | Expiry is checked against the server's own clock (Node and MySQL on the same PC), so client clocks don't matter. Make sure MySQL and Node use the same system time, and type the Token ID within 60 seconds |
