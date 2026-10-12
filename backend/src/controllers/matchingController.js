/**
 * Matching and placement (Admin, assigned Staff with the record unlocked). See services/matching.js.
 * Child profile for matching (needs, siblings, room; the child's documents verified by Admin).
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { logActivity, logActivityWith } = require('../utils/audit');
const M = require('../services/matching');

const C = () => require('./adoptionController')._detail;
const toId = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Match not found.'); return n; };

/** Loads the application with the same access rules as the rest of the record (assigned + unlocked, or Admin). */
async function load(req) {
  const { loadById, requireSensitive } = C();
  const app = await loadById(req);
  await requireSensitive(req, app, 'Matching');
  return app;
}
const done = async (req, res, app) => res.json({ success: true, data: { matches: await M.matchesFor(pool, app.application_id) } });

/** GET /api/adoptions/:id/matching/preview?child_id= - hard blocks and the compatibility review. */
exports.preview = async (req, res) => {
  const app = await load(req);
  res.json({ success: true, data: await M.preview(app, req.query.child_id ? String(req.query.child_id) : null) });
};
exports.propose = async (req, res) => { const app = await load(req); await M.propose(req, app, req.body || {}); await done(req, res, app); };
exports.review = async (req, res) => { const app = await load(req); await M.startReview(req, app, toId(req.params.mid)); await done(req, res, app); };
exports.approve = async (req, res) => { const app = await load(req); await M.approve(req, app, toId(req.params.mid), req.body || {}); await done(req, res, app); };
exports.nacc = async (req, res) => { const app = await load(req); await M.recordNacc(req, app, toId(req.params.mid), req.body || {}); await done(req, res, app); };
exports.withdraw = async (req, res) => { const app = await load(req); await M.withdraw(req, app, toId(req.params.mid), req.body || {}); await done(req, res, app); };
exports.link = async (req, res) => { const app = await load(req); await M.verifyLink(req, app, req.body || {}); res.json({ success: true, data: { ok: true } }); };

// ---------------------------------------------------------------- child profile for matching

async function childOr404(id) {
  const c = await M.childProfile(pool, String(id));
  if (!c) throw new HttpError(404, 'Child record not found.');
  return c;
}
const profileView = (c) => ({
  child_id: c.child_id, age: c.age, special_needs: c.special_needs, sibling_group_size: c.sibling_group_size,
  needs_own_room: c.needs_own_room === null ? null : !!c.needs_own_room, documents: c.documents,
  available_for_adoption: !!c.available_for_adoption, cdclaa_verified: !!c.cdclaa_verified_at, placement_status: c.placement_status,
});

/** GET /api/children/:id/match-profile (Admin, Staff with the adoption duty) */
exports.getProfile = async (req, res) => {
  res.json({ success: true, data: profileView(await childOr404(req.params.id)) });
};

/** PUT /api/children/:id/match-profile (Admin) { special_needs, sibling_group_size, needs_own_room } */
exports.saveProfile = async (req, res) => {
  const c = await childOr404(req.params.id);
  const b = req.body || {};
  const needs = b.special_needs === '' || b.special_needs === null ? null : String(b.special_needs);
  if (needs !== null && !['None', 'Some', 'Significant'].includes(needs)) throw new HttpError(400, 'Choose None, Some or Significant.');
  const sibs = b.sibling_group_size === '' || b.sibling_group_size === null || b.sibling_group_size === undefined ? null : Number(b.sibling_group_size);
  if (sibs !== null && (!Number.isInteger(sibs) || sibs < 0 || sibs > 10)) throw new HttpError(400, 'Enter 0 to 10 siblings.');
  const room = b.needs_own_room === null || b.needs_own_room === '' || b.needs_own_room === undefined ? null : Boolean(b.needs_own_room === true || b.needs_own_room === 'true');
  await pool.query('UPDATE tbl_children SET special_needs = ?, sibling_group_size = ?, needs_own_room = ? WHERE child_id = ?', [needs, sibs, room === null ? null : room ? 1 : 0, c.child_id]);
  await logActivity(req, 'CHILD_MATCH_PROFILE_UPDATED', `Child ${c.child_id}`);
  res.json({ success: true, data: profileView(await childOr404(c.child_id)) });
};

/** POST /api/children/:id/match-documents/:key/verify (Admin) { reference } - a person's verification, logged. */
exports.verifyChildDocument = async (req, res) => {
  const c = await childOr404(req.params.id);
  const key = String(req.params.key || '');
  if (!M.CHILD_DOCS.some((d) => d.key === key)) throw new HttpError(400, 'Unknown document.');
  const ref = String(req.body?.reference || '').trim().slice(0, 120);
  if (ref.length < 3) throw new HttpError(400, 'Enter where the original is filed or its reference (at least 3 characters).');
  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO tbl_child_match_documents (child_id, doc_key, verified_at, verified_by, reference) VALUES (?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE verified_at = NOW(), verified_by = VALUES(verified_by), reference = VALUES(reference)`, [c.child_id, key, req.user.user_id, ref]);
    await logActivityWith(conn, req, `CHILD_DOCUMENT_VERIFIED (${key})`, `Child ${c.child_id}`);
  });
  res.json({ success: true, data: profileView(await childOr404(c.child_id)) });
};
