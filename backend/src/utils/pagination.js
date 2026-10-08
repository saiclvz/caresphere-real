const HttpError = require('./HttpError');

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_LIMIT = 20;

/**
 * Reads ?page=&limit= for server-side pagination. Returns null when no page is asked for,
 * so endpoints that also feed full lists (pickers, forms) keep returning everything.
 * limit must be one of 10, 20, 50.
 */
function readPagination(query) {
  if (query.page === undefined && query.limit === undefined) return null;
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) throw new HttpError(400, 'page must be a whole number of at least 1.');
  if (!PAGE_SIZES.includes(limit)) throw new HttpError(400, `limit must be one of ${PAGE_SIZES.join(', ')}.`);
  return { page, limit };
}

/**
 * Turns a total count into page details. A page past the end is moved to the last page,
 * so deleting the last row on a page never leaves an empty screen.
 */
function pageInfo({ page, limit }, total) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const current = Math.min(page, totalPages);
  return { page: current, limit, total, total_pages: totalPages, offset: (current - 1) * limit };
}

module.exports = { readPagination, pageInfo, PAGE_SIZES };
