const HttpError = require('../utils/HttpError');

function notFound(req, res, next) {
  next(new HttpError(404, `No API route matches ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'Unexpected server error.';

  // Translate common MySQL errors into meaningful client responses.
  switch (err.code) {
    case 'ER_DUP_ENTRY':
      status = 409; message = 'A record with the same unique value already exists.'; break;
    case 'ER_NO_REFERENCED_ROW_2':
      status = 400; message = 'A referenced record does not exist.'; break;
    case 'ER_ROW_IS_REFERENCED_2':
      status = 409; message = 'This record is referenced by other records and cannot be deleted. Deactivate it instead.'; break;
    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
      status = 503; message = 'The database is unavailable. Check that MySQL is running in XAMPP.'; break;
    default:
      break;
  }

  if (err.type === 'entity.parse.failed') { status = 400; message = 'Request body is not valid JSON.'; }
  if (err.type === 'entity.too.large') { status = 413; message = 'The upload is too large. Photos can be up to 5 MB and documents up to 10 MB.'; }

  // Server log: the message and code only (never the SQL with its values), with long numbers and codes masked to
  // the last 4 characters, so reference, account and phone numbers don't end up in the log in plain text.
  if (status >= 500) {
    const safe = (v) => String(v || '').replace(/[A-Za-z0-9]{0,}\d[A-Za-z0-9-]{4,}/g, (m) => (m.length > 4 ? `****${m.slice(-4)}` : m));
    console.error(`[error] ${req.method} ${safe(String(req.originalUrl).split('?')[0])} ${err.code || ''} ${safe(err.message)}`);
    if (process.env.NODE_ENV !== 'production' && err.stack) console.error(safe(err.stack.split('\n').slice(1, 6).join('\n')));
  }

  res.status(status).json({
    success: false,
    // Never a stack trace or a database message to the client.
    message: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong. Try again, or contact the administrator.' : message,
    ...(err.details ? { details: err.details } : {}),
    // Lets the client tell an expired sign-in apart from a wrong token or password.
    ...(err.session ? { session: true } : {}),
    ...(err.csrf ? { csrf: true } : {}),
    ...(err.mustChangePassword ? { must_change_password: true } : {}),
  });
}

module.exports = { notFound, errorHandler };
