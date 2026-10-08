const HttpError = require('../utils/HttpError');
const { DUTIES, DUTY_FOR_RECORD } = require('../config/staffDuties');

/** Staff may only use the areas in their duties (loaded with the signed-in user). Admin and Donors pass. */
function denied(duty) {
  return new HttpError(403, `ACCESS DENIED – You are not authorized to view this information. ${DUTIES[duty]?.label || duty} is not one of your duties.`, { duty });
}
const hasDuty = (req, duty) => req.user?.role !== 'Staff' || (req.user.duties || []).includes(duty);

/** Refused: logged as a security event (like role refusals), then the ACCESS DENIED response. */
function refuse(req, next, duty) {
  require('../utils/audit').logSecurityEvent(req, 'UNAUTHORIZED_ACCESS', { detail: `No ${duty} duty: ${req.method} ${req.originalUrl}`.slice(0, 300) });
  require('../utils/audit').logActivity(req, `ACCESS_DENIED_DUTY (${duty})`, `${req.method} ${String(req.originalUrl || '').split('?')[0]}`.slice(0, 120)).catch(() => {});
  return next(denied(duty));
}
const requireDuty = (duty) => (req, res, next) => (hasDuty(req, duty) ? next() : refuse(req, next, duty));

/** The unlock flow: the duty follows the record type in the body. */
const requireDutyForUnlock = (req, res, next) => {
  const duty = DUTY_FOR_RECORD[String(req.body?.record_type || '')];
  return !duty || hasDuty(req, duty) ? next() : refuse(req, next, duty);
};

module.exports = { requireDuty, requireDutyForUnlock, hasDuty };
