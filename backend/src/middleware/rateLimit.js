const HttpError = require('../utils/HttpError');

/**
 * Minimal in-memory fixed-window rate limiter (single-process LAN server).
 *   key:    'ip' (default) | 'user' | 'global' | a function (req) => string
 *   max:    a number, or a function (req) => number (for limits that come from Settings)
 */
function rateLimit({ windowMs, max, message, key = 'ip' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.reset <= now) hits.delete(k);
  }, windowMs).unref();

  const keyOf = (req) => (typeof key === 'function' ? key(req)
    : key === 'user' ? `u:${req.user?.user_id ?? req.ip}` : key === 'global' ? 'all' : `ip:${req.ip}`);

  return async (req, res, next) => {
    try {
      const k = keyOf(req);
      const limit = typeof max === 'function' ? await max(req) : max;
      const now = Date.now();
      let entry = hits.get(k);
      if (!entry || entry.reset <= now) {
        entry = { count: 0, reset: now + windowMs };
        hits.set(k, entry);
      }
      entry.count += 1;
      if (entry.count > limit) {
        res.set('Retry-After', Math.ceil((entry.reset - now) / 1000));
        return next(new HttpError(429, message));
      }
      next();
    } catch (err) { next(err); }
  };
}

module.exports = rateLimit;
