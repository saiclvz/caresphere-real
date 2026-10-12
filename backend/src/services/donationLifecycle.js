/**
 * Donation lifecycle rules (config/donationLifecycle.js has the lists). Every function runs on the caller's
 * transaction connection, so a change, its history row, its stock movements and its audit entry commit
 * together. Nothing here deletes a donation: Void is a status with a reason, and stock it added is taken
 * back out with reversal movements.
 */
const HttpError = require('../utils/HttpError');
const { encField, decField } = require('../utils/fieldCrypto');
const { logActivityWith } = require('../utils/audit');
const L = require('../config/donationLifecycle');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const pad4 = (n) => (n > 9999 ? String(n) : String(n).padStart(4, '0'));
const nameKey = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isInKind = (d) => String(d.payment_method).toLowerCase() === 'in-kind';
const fail = (errors, message = 'Some answers need attention.') => { if (Object.keys(errors).length) throw new HttpError(422, message, { errors }); };

// ---------------------------------------------------------------- numbers

/** Next value of a counter, row-locked so two saves never get the same number. */
async function nextValue(conn, key) {
  await conn.query('INSERT IGNORE INTO tbl_number_sequences (seq_key, next_value) VALUES (?, 1)', [key]);
  const [[row]] = await conn.query('SELECT next_value FROM tbl_number_sequences WHERE seq_key = ? FOR UPDATE', [key]);
  await conn.query('UPDATE tbl_number_sequences SET next_value = next_value + 1 WHERE seq_key = ?', [key]);
  return Number(row.next_value);
}
async function donationNumber(conn, when = new Date()) {
  const y = new Date(when).getFullYear();
  return `DNT-${y}-${pad4(await nextValue(conn, `DNT-${y}`))}`;
}
const donorCode = async (conn) => `DNR-${pad4(await nextValue(conn, 'DNR'))}`;

// ---------------------------------------------------------------- donor records

/** The donor record of a donor account (created the first time it is needed). */
async function donorForAccount(conn, user, actorId = null) {
  const [[found]] = await conn.query('SELECT donor_ref_id FROM tbl_donors WHERE user_id = ?', [user.user_id]);
  if (found) return found.donor_ref_id;
  const [r] = await conn.query("INSERT INTO tbl_donors (donor_code, donor_type, display_name, name_key, user_id, origin, created_by) VALUES (?, 'Individual', ?, ?, ?, 'account', ?)",
    [await donorCode(conn), user.full_name, nameKey(user.full_name), user.user_id, actorId]);
  return r.insertId;
}

/**
 * A walk-in (or staff-recorded) donor without an account: the same name and contact number is the same donor;
 * anything else is a new record (possible duplicates are reported, never merged automatically).
 */
async function donorForWalkIn(conn, { name, contact, type = 'Individual' }, actorId = null) {
  const key = nameKey(name);
  const [rows] = await conn.query("SELECT donor_ref_id, contact_enc FROM tbl_donors WHERE name_key = ? AND user_id IS NULL AND donor_type = ? FOR UPDATE", [key, type]);
  const same = rows.find((r) => (decField(r.contact_enc) || '') === (contact || ''));
  if (same) return same.donor_ref_id;
  const [r] = await conn.query("INSERT INTO tbl_donors (donor_code, donor_type, display_name, name_key, contact_enc, origin, created_by) VALUES (?, ?, ?, ?, ?, 'walk_in', ?)",
    [await donorCode(conn), type, String(name).trim().replace(/\s+/g, ' ').slice(0, 150), key, contact ? encField(contact) : null, actorId]);
  return r.insertId;
}

// ---------------------------------------------------------------- allocation

/** Maps a free-text allocation to programs. One clear program: that program. None or several: "Other" (Needs review). */
function mapAllocation(text, { amount = null, inKind = false } = {}) {
  const original = String(text || '').trim();
  const low = ` ${original.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
  const hits = Object.entries(L.PROGRAM_KEYWORDS).filter(([, words]) => words.some((w) => low.includes(` ${w} `))).map(([p]) => p);
  const specific = hits.filter((p) => p !== 'General support');
  const programs = specific.length ? specific : hits;
  const amt = inKind ? null : (amount === null ? null : round2(amount));
  if (!original) return { purpose: null, lines: [], matched: [] };
  if (programs.length === 1) {
    return { purpose: programs[0], matched: programs, lines: [{ program: programs[0], amount: amt, intended_use: original.slice(0, 500), needs_review: false, original_text: original }] };
  }
  return { purpose: 'Other', matched: programs, lines: [{ program: 'Other', amount: amt, intended_use: `Other: ${original}`.slice(0, 500), needs_review: true, original_text: original }] };
}

async function activeAllocations(conn, donationId) {
  const [rows] = await conn.query('SELECT allocation_id, program, amount, intended_use, needs_review, original_text FROM tbl_donation_allocations WHERE donation_id = ? AND superseded_at IS NULL ORDER BY allocation_id', [donationId]);
  return rows.map((r) => ({ ...r, amount: r.amount === null ? null : Number(r.amount), needs_review: !!r.needs_review }));
}

/** Cleans allocation lines from a form. Cash: program + amount, adding up to the donation amount. In-kind: program + intended use. */
function cleanAllocation(raw, { amount, inKind }, errors) {
  const list = (Array.isArray(raw) ? raw : []).slice(0, 20);
  const out = [];
  list.forEach((l, i) => {
    const program = String(l?.program || '').trim();
    const use = String(l?.intended_use || '').trim().slice(0, 500);
    if (!program && !use && (l?.amount === undefined || l?.amount === '')) return;
    if (!L.PROGRAMS.includes(program)) errors[`allocation_${i}`] = 'Choose a program.';
    let amt = null;
    if (!inKind) {
      amt = Number(l?.amount);
      if (!(amt > 0)) errors[`allocation_${i}`] = errors[`allocation_${i}`] || 'Enter the amount for this program.';
      amt = round2(amt);
    } else if (!use) errors[`allocation_${i}`] = errors[`allocation_${i}`] || 'Describe the intended use.';
    if (program === 'Other' && !use) errors[`allocation_${i}`] = 'Describe the use for "Other".';
    out.push({ program, amount: amt, intended_use: use || null, needs_review: false, original_text: null });
  });
  if (!out.length) errors.allocation = 'Add at least one allocation line.';
  else if (!inKind && Object.keys(errors).every((k) => !k.startsWith('allocation_'))) {
    const sum = round2(out.reduce((s, l) => s + l.amount, 0));
    if (Math.abs(sum - round2(amount)) > 0.009) errors.allocation = `The allocation adds up to ₱${sum.toFixed(2)}; it must equal the amount, ₱${round2(amount).toFixed(2)}.`;
  }
  return out;
}

/** Replaces the active allocation (earlier lines are kept, marked superseded) and the text summary. */
async function setAllocation(conn, req, d, lines, { purpose } = {}) {
  await conn.query('UPDATE tbl_donation_allocations SET superseded_at = NOW() WHERE donation_id = ? AND superseded_at IS NULL', [d.donation_id]);
  for (const l of lines) {
    await conn.query('INSERT INTO tbl_donation_allocations (donation_id, program, amount, intended_use, needs_review, original_text, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [d.donation_id, l.program, l.amount, l.intended_use, l.needs_review ? 1 : 0, l.original_text, req?.user?.user_id || null]);
  }
  const summary = lines.map((l) => `${l.program}${l.amount !== null && l.amount !== undefined ? ` ₱${Number(l.amount).toFixed(2)}` : ''}${l.intended_use && l.program !== 'Other' ? `: ${l.intended_use}` : l.program === 'Other' ? `: ${String(l.intended_use || '').replace(/^Other: /, '')}` : ''}`).join('; ');
  await conn.query('UPDATE tbl_donations SET allocation_notes = ?, purpose = COALESCE(?, purpose, ?), last_activity_at = NOW() WHERE donation_id = ?',
    [summary.slice(0, 3000) || null, purpose || null, lines[0]?.program || null, d.donation_id]);
}

/** Why the allocation isn't ready for acceptance (empty list = ready). */
async function allocationProblems(conn, d) {
  const lines = await activeAllocations(conn, d.donation_id);
  if (!lines.length) return ['Add the allocation (programs and amounts, or the intended use for in-kind).'];
  const p = [];
  if (lines.some((l) => l.needs_review)) p.push('Review the allocation lines marked "Needs review".');
  if (!isInKind(d)) {
    if (lines.some((l) => l.amount === null)) p.push('Every allocation line needs an amount.');
    else if (Math.abs(round2(lines.reduce((s, l) => s + l.amount, 0)) - round2(d.amount)) > 0.009) p.push('The allocation must add up to the donation amount.');
  }
  return p;
}

// ---------------------------------------------------------------- history and status

async function history(conn, donationId, from, to, note, actorId) {
  await conn.query('INSERT INTO tbl_donation_status_history (donation_id, from_status, to_status, note, actor_id) VALUES (?, ?, ?, ?, ?)',
    [donationId, from, to, note ? String(note).slice(0, 255) : null, actorId || null]);
}

async function lockDonation(conn, id) {
  const [[d]] = await conn.query('SELECT * FROM tbl_donations WHERE donation_id = ? FOR UPDATE', [id]);
  if (!d) throw new HttpError(404, 'Donation not found.');
  return d;
}

async function setStatus(conn, req, d, to, note) {
  await conn.query(`UPDATE tbl_donations SET status = ?, received_at = IF(? = 'Received' AND received_at IS NULL, NOW(), received_at), last_activity_at = NOW() WHERE donation_id = ?`, [to, to, d.donation_id]);
  await history(conn, d.donation_id, d.status, to, note, req?.user?.user_id);
  if (req?.user?.user_id) await logActivityWith(conn, req, `DONATION_STATUS (${d.status} -> ${to})`, `Donation #${d.donation_id}`);
  d.status = to;
}

/**
 * A manual step (the page offers only the next allowed one). Accepting needs a complete allocation (and item
 * lines for in-kind); rejecting needs a reason.
 */
async function transition(conn, req, d, to, note) {
  if (!(L.TRANSITIONS[d.status] || []).includes(to)) throw new HttpError(409, `A ${d.status.toLowerCase()} donation can't be moved to ${to}.`);
  if (to === 'Accepted') {
    const problems = await allocationProblems(conn, d);
    if (isInKind(d)) {
      const [[n]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_donation_item_lines WHERE donation_id = ?', [d.donation_id]);
      if (!Number(n.n)) problems.push('Record the donated items first.');
    }
    if (problems.length) throw new HttpError(409, `Allocation is required before a donation can be accepted. ${problems.join(' ')}`, { problems });
  }
  if (to === 'Rejected' && !String(note || '').trim()) throw new HttpError(422, 'Give the reason for rejecting.', { errors: { note: 'Give the reason for rejecting.' } });
  await setStatus(conn, req, d, to, note);
}

// ---------------------------------------------------------------- acknowledgment (the receipt)

/** Issues (or reissues, with a reason) the acknowledgment. Accepted donations move to Acknowledged. */
async function acknowledge(conn, req, d, { reason } = {}) {
  if (d.status === 'Voided') throw new HttpError(409, 'This donation was voided. No acknowledgment can be issued.');
  if (!['Accepted', ...L.ACKNOWLEDGED_OR_LATER].includes(d.status)) throw new HttpError(409, 'The acknowledgment is issued once the donation is accepted (allocation set).');
  if (d.status === 'Accepted') {
    // e.g. a converted donation whose old allocation text was flagged "Needs review"
    const problems = await allocationProblems(conn, d);
    if (problems.length) throw new HttpError(409, `Fix the allocation before issuing the acknowledgment. ${problems.join(' ')}`, { problems });
  }
  const [[last]] = await conn.query('SELECT MAX(version) AS v FROM tbl_donation_acknowledgments WHERE donation_id = ?', [d.donation_id]);
  const version = Number(last.v || 0) + 1;
  if (version > 1 && !String(reason || '').trim()) throw new HttpError(422, 'Give the reason for reissuing the acknowledgment.', { errors: { reason: 'Give the reason for reissuing.' } });
  await conn.query('INSERT INTO tbl_donation_acknowledgments (donation_id, version, issued_by, reissue_reason) VALUES (?, ?, ?, ?)',
    [d.donation_id, version, req?.user?.user_id || null, version > 1 ? String(reason).slice(0, 255) : null]);
  await conn.query('UPDATE tbl_donations SET receipt_issued = TRUE, last_activity_at = NOW() WHERE donation_id = ?', [d.donation_id]);
  if (req?.user?.user_id) await logActivityWith(conn, req, version > 1 ? `ACKNOWLEDGMENT_REISSUED (version ${version})` : 'ACKNOWLEDGMENT_ISSUED', `Donation #${d.donation_id}`);
  if (d.status === 'Accepted') await setStatus(conn, req, d, 'Acknowledged', version > 1 ? 'Acknowledgment reissued' : 'Acknowledgment issued');
  return version;
}

// ---------------------------------------------------------------- distribution (in-kind) and utilization (cash)

async function distributionTotals(conn, d) {
  if (isInKind(d)) {
    const [[r]] = await conn.query(`SELECT COALESCE(SUM(received_qty), 0) AS received, COALESCE(SUM(received_qty - remaining_qty), 0) AS used FROM tbl_inventory_lots WHERE donation_id = ?`, [d.donation_id]);
    return { total: Number(r.received), used: Number(r.used) };
  }
  const [[r]] = await conn.query("SELECT COALESCE(SUM(amount), 0) AS used FROM tbl_donation_distributions WHERE donation_id = ? AND kind = 'utilization'", [d.donation_id]);
  return { total: round2(d.amount), used: round2(r.used) };
}

async function syncDistributedStatus(conn, req, d) {
  const t = await distributionTotals(conn, d);
  const to = t.used <= 0 ? null : t.used + 0.0001 >= t.total ? 'Fully distributed' : 'Partially distributed';
  if (to && to !== d.status && L.DISTRIBUTABLE.includes(d.status)) await setStatus(conn, req, d, to, to === 'Fully distributed' ? 'Everything distributed or used' : 'Part distributed or used');
}

/**
 * In-kind: takes the quantity from this line's lots, earliest expiry first; never more than what is left.
 * Each lot used gets a distribution row and an inventory OUT movement.
 */
async function recordDistribution(conn, req, d, body, moveStock) {
  if (!L.DISTRIBUTABLE.includes(d.status)) throw new HttpError(409, 'Confirm the allocation (Allocated) before recording distribution.');
  const errors = {};
  const lineId = Number(body.line_id);
  const qty = Number(body.quantity);
  const program = String(body.program || '').trim();
  const usedOn = String(body.used_on || '').trim();
  const note = String(body.note || '').trim().slice(0, 500);
  if (!Number.isInteger(qty) || qty < 1) errors.quantity = 'Enter a whole number of at least 1.';
  if (!L.PROGRAMS.includes(program)) errors.program = 'Choose the program.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(usedOn)) errors.used_on = 'Enter the date.'; else if (usedOn > today()) errors.used_on = "The date can't be in the future.";
  const [[line]] = await conn.query('SELECT * FROM tbl_donation_item_lines WHERE line_id = ? AND donation_id = ?', [lineId, d.donation_id]);
  if (!line) errors.line_id = 'Choose the item.';
  fail(errors);
  const [lots] = await conn.query('SELECT * FROM tbl_inventory_lots WHERE line_id = ? AND remaining_qty > 0 ORDER BY expiry_date IS NULL, expiry_date, lot_id FOR UPDATE', [lineId]);
  const left = lots.reduce((s, l) => s + l.remaining_qty, 0);
  if (qty > left) fail({ quantity: `Only ${left} left from this donation.` });
  let need = qty;
  for (const lot of lots) {
    if (!need) break;
    const take = Math.min(need, lot.remaining_qty);
    await conn.query('UPDATE tbl_inventory_lots SET remaining_qty = remaining_qty - ? WHERE lot_id = ?', [take, lot.lot_id]);
    await moveStock(conn, { itemId: lot.item_id, change: -take, type: 'distribution_out', donationId: d.donation_id, userId: req.user.user_id, lotId: lot.lot_id, note: `Distributed: ${program}` });
    await conn.query("INSERT INTO tbl_donation_distributions (donation_id, kind, line_id, lot_id, quantity, program, used_on, note, recorded_by) VALUES (?, 'distribution', ?, ?, ?, ?, ?, ?, ?)",
      [d.donation_id, lineId, lot.lot_id, take, program, usedOn, note || null, req.user.user_id]);
    need -= take;
  }
  await logActivityWith(conn, req, `DONATION_DISTRIBUTED (${qty}, ${program})`, `Donation #${d.donation_id}`);
  await conn.query('UPDATE tbl_donations SET last_activity_at = NOW() WHERE donation_id = ?', [d.donation_id]);
  await syncDistributedStatus(conn, req, d);
}

/** Cash: records how much was used, for which program; never more than what is left. */
async function recordUtilization(conn, req, d, body) {
  if (!L.DISTRIBUTABLE.includes(d.status)) throw new HttpError(409, 'Confirm the allocation (Allocated) before recording how the funds were used.');
  const errors = {};
  const amount = round2(body.amount);
  const program = String(body.program || '').trim();
  const usedOn = String(body.used_on || '').trim();
  if (!(amount > 0)) errors.amount = 'Enter the amount used.';
  if (!L.PROGRAMS.includes(program)) errors.program = 'Choose the program.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(usedOn)) errors.used_on = 'Enter the date.'; else if (usedOn > today()) errors.used_on = "The date can't be in the future.";
  fail(errors);
  const t = await distributionTotals(conn, d);
  if (amount > round2(t.total - t.used) + 0.0001) fail({ amount: `Only ₱${round2(t.total - t.used).toFixed(2)} of this donation is left to use.` });
  await conn.query("INSERT INTO tbl_donation_distributions (donation_id, kind, amount, program, used_on, note, recorded_by) VALUES (?, 'utilization', ?, ?, ?, ?, ?)",
    [d.donation_id, amount, program, usedOn, String(body.note || '').trim().slice(0, 500) || null, req.user.user_id]);
  await logActivityWith(conn, req, `DONATION_UTILIZED (PHP ${amount.toFixed(2)}, ${program})`, `Donation #${d.donation_id}`);
  await conn.query('UPDATE tbl_donations SET last_activity_at = NOW() WHERE donation_id = ?', [d.donation_id]);
  await syncDistributedStatus(conn, req, d);
}

// ---------------------------------------------------------------- void

function cleanVoid(body) {
  const reason = String(body?.reason || '').trim();
  const note = String(body?.note || '').trim().slice(0, 500);
  const errors = {};
  if (!L.VOID_REASONS.includes(reason)) errors.reason = 'Choose the reason.';
  if (reason === 'Other' && !note) errors.note = 'Describe the reason.';
  fail(errors);
  return { reason, note };
}

/**
 * Admin voids. Stock still from this donation is taken back out with void-reversal movements (the IN movements
 * are never edited). If any of it was already distributed or used, the void is refused unless the Admin
 * records it as a correction (with a note): then only what is left is reversed.
 */
async function voidDonation(conn, req, d, body, moveStock) {
  if (req.user.role !== 'Admin') throw new HttpError(403, 'Only an administrator can void a donation. Request a void instead.');
  if (d.status === 'Voided') throw new HttpError(409, 'This donation is already voided.');
  const { reason, note } = cleanVoid(body);
  const correction = body?.correction === true;
  const [[dist]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_donation_distributions WHERE donation_id = ?', [d.donation_id]);
  if (Number(dist.n) && !correction) {
    throw new HttpError(409, 'Some of this donation was already distributed or used. To void it anyway, record it as a correction with a note (only what is left is reversed).', { needs_correction: true });
  }
  if (correction && !note) fail({ note: 'Explain the correction.' });
  const reversed = [];
  const [lots] = await conn.query('SELECT * FROM tbl_inventory_lots WHERE donation_id = ? AND remaining_qty > 0 FOR UPDATE', [d.donation_id]);
  if (lots.length) {
    for (const lot of lots) {
      reversed.push(await moveStock(conn, { itemId: lot.item_id, change: -lot.remaining_qty, type: 'void_reversal', donationId: d.donation_id, userId: req.user.user_id, lotId: lot.lot_id, note: `Void: ${reason}` }));
      await conn.query('UPDATE tbl_inventory_lots SET remaining_qty = 0 WHERE lot_id = ?', [lot.lot_id]);
    }
  } else {
    // Not converted yet (no lots): reverse the stock recorded with the donation's items.
    const [[conv]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_inventory_lots WHERE donation_id = ?', [d.donation_id]);
    if (!Number(conv.n)) {
      const [items] = await conn.query('SELECT inventory_item_id AS item_id, quantity FROM tbl_donation_items WHERE donation_id = ?', [d.donation_id]);
      for (const it of items) {
        const [[inv]] = await conn.query('SELECT quantity FROM tbl_inventory WHERE item_id = ? FOR UPDATE', [it.item_id]);
        const take = correction ? Math.min(it.quantity, inv.quantity) : it.quantity;
        if (take > inv.quantity) throw new HttpError(409, 'Some of these items are no longer in stock (already used). Record the void as a correction (Admin) to reverse only what is left.', { needs_correction: true });
        if (take > 0) reversed.push(await moveStock(conn, { itemId: it.item_id, change: -take, type: 'void_reversal', donationId: d.donation_id, userId: req.user.user_id, note: `Void: ${reason}` }));
      }
    }
  }
  await conn.query('UPDATE tbl_donations SET void_reason = ?, void_note = ?, voided_by = ?, voided_at = NOW() WHERE donation_id = ?', [reason, note || null, req.user.user_id, d.donation_id]);
  if (correction) {
    await conn.query("INSERT INTO tbl_donation_corrections (donation_id, field, old_value, new_value, reason, made_by) VALUES (?, 'status', ?, 'Voided', ?, ?)", [d.donation_id, d.status, note, req.user.user_id]);
  }
  await setStatus(conn, req, d, 'Voided', `Voided: ${reason}${correction ? ' (correction)' : ''}`);
  await conn.query("UPDATE tbl_donation_void_requests SET status = 'Approved', decided_by = ?, decided_at = NOW(), decision_note = COALESCE(decision_note, 'Voided') WHERE donation_id = ? AND status = 'Pending'", [req.user.user_id, d.donation_id]);
  await logActivityWith(conn, req, `DONATION_VOIDED (${reason}${correction ? ', correction' : ''})`, `Donation #${d.donation_id}`);
  for (const it of reversed) await logActivityWith(conn, req, `INVENTORY_VOID_REVERSAL (-${it.quantity}, donation #${d.donation_id})`, `Inventory #${it.item_id}`);
  return reversed;
}

/** Staff ask an Admin to void (one open request per donation). Admins are notified with the donation number only. */
async function requestVoid(conn, req, d, body) {
  if (d.status === 'Voided') throw new HttpError(409, 'This donation is already voided.');
  const { reason, note } = cleanVoid(body);
  const [[open]] = await conn.query("SELECT request_id FROM tbl_donation_void_requests WHERE donation_id = ? AND status = 'Pending'", [d.donation_id]);
  if (open) throw new HttpError(409, 'A void request for this donation is already waiting for an administrator.');
  await conn.query('INSERT INTO tbl_donation_void_requests (donation_id, reason, note, requested_by) VALUES (?, ?, ?, ?)', [d.donation_id, reason, note || null, req.user.user_id]);
  await conn.query('UPDATE tbl_donations SET last_activity_at = NOW() WHERE donation_id = ?', [d.donation_id]);
  await logActivityWith(conn, req, `DONATION_VOID_REQUESTED (${reason})`, `Donation #${d.donation_id}`);
  await require('./notifications').toAdmins(conn, 'admin_void_requested', { entityType: 'donation', entityId: d.donation_id, params: { id: d.donation_id, ref: d.donation_no }, groupKey: `void_req:${d.donation_id}` });
}

async function declineVoid(conn, req, d, note) {
  if (req.user.role !== 'Admin') throw new HttpError(403, 'Only an administrator decides void requests.');
  const [r] = await conn.query("UPDATE tbl_donation_void_requests SET status = 'Declined', decided_by = ?, decided_at = NOW(), decision_note = ? WHERE donation_id = ? AND status = 'Pending'",
    [req.user.user_id, String(note || '').slice(0, 500) || null, d.donation_id]);
  if (!r.affectedRows) throw new HttpError(409, 'There is no open void request for this donation.');
  await logActivityWith(conn, req, 'DONATION_VOID_DECLINED', `Donation #${d.donation_id}`);
}

// ---------------------------------------------------------------- corrections (after acknowledgment)

/** A correction entry: the field, old and new values, and the reason. The change itself is applied with it. */
async function correction(conn, req, d, field, oldValue, newValue, reason) {
  if (!String(reason || '').trim()) fail({ reason: 'Give the reason for the correction.' });
  await conn.query('INSERT INTO tbl_donation_corrections (donation_id, field, old_value, new_value, reason, made_by) VALUES (?, ?, ?, ?, ?, ?)',
    [d.donation_id, field, oldValue === null || oldValue === undefined ? null : String(oldValue).slice(0, 500), newValue === null || newValue === undefined ? null : String(newValue).slice(0, 500), String(reason).trim().slice(0, 500), req.user.user_id]);
  await conn.query('UPDATE tbl_donations SET last_activity_at = NOW() WHERE donation_id = ?', [d.donation_id]);
  await logActivityWith(conn, req, `DONATION_CORRECTION (${field})`, `Donation #${d.donation_id}`);
}

/**
 * Portal gifts (paid online, or a bank transfer staff confirmed): one allocation line for the whole amount,
 * Accepted, and the acknowledgment issued (so the donor's receipt is ready, as before). Runs in the caller's
 * transaction; `req` is null for the payment webhook (no acting user).
 */
async function acceptPortalGift(conn, req, donationId, { purpose, use, note }) {
  const d0 = await lockDonation(conn, donationId);
  const d = { ...d0, amount: Number(d0.amount) };
  const program = L.PROGRAMS.includes(purpose) ? purpose : 'General support';
  await setAllocation(conn, req, d, [{ program, amount: round2(d.amount), intended_use: use ? String(use).slice(0, 500) : null, needs_review: false, original_text: null }], { purpose: program });
  await conn.query('UPDATE tbl_donations SET purpose = ? WHERE donation_id = ?', [program, donationId]);
  if (d.status !== 'Accepted') await setStatus(conn, req, d, 'Accepted', note || 'Allocation recorded');
  await acknowledge(conn, req, d, {});
  return d;
}

/** The program a donor's own words point to, or General support when unclear. */
function purposeFromText(text) {
  const m = mapAllocation(text, { amount: 0 });
  return m.lines[0] && !m.lines[0].needs_review ? m.purpose : 'General support';
}

module.exports = {
  acceptPortalGift, purposeFromText,
  nextValue, donationNumber, donorCode, donorForAccount, donorForWalkIn, nameKey, mapAllocation, activeAllocations, cleanAllocation,
  setAllocation, allocationProblems, history, lockDonation, setStatus, transition, acknowledge, distributionTotals, syncDistributedStatus,
  recordDistribution, recordUtilization, cleanVoid, voidDonation, requestVoid, declineVoid, correction, isInKind, round2, today,
};
