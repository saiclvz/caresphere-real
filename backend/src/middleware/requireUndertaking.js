const HttpError = require('../utils/HttpError');
const { sessionAccepted } = require('../services/compliance');
const U = require('../config/undertaking');

/**
 * Admin and Staff must have accepted the confidentiality undertaking for the area in this sign-in
 * session before any of the area's data is returned. Admin has no bypass. Donors pass through (they
 * only ever reach their own application).
 */
async function check(req, area) {
  if (!['Admin', 'Staff'].includes(req.user?.role)) return;
  if (await sessionAccepted(req.auth?.jti, area)) return;
  throw new HttpError(403, `Accept the confidentiality undertaking to open ${U.AREAS[area].records}.`, { undertaking_required: true, area });
}

/** For routes of one area: requireUndertaking('adoption') or requireUndertaking('transition'). */
const requireUndertaking = (area) => (req, res, next) => check(req, area).then(() => next(), next);

/** For the unlock flow: the area comes from the record type in the body (health records have no undertaking). */
const UNLOCK_AREAS = { adoption_application: 'adoption', transition_review: 'transition' };
const requireUndertakingForUnlock = (req, res, next) => {
  const area = UNLOCK_AREAS[String(req.body?.record_type || '')];
  if (!area) return next();
  return check(req, area).then(() => next(), next);
};

module.exports = { requireUndertaking, requireUndertakingForUnlock };
