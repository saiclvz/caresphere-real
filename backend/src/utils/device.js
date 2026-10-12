/** Device type from the browser's User-Agent, for the audit log: phone, tablet or computer. */
function deviceType(req) {
  const ua = String(req?.headers?.['user-agent'] || '');
  if (!ua) return null;
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i.test(ua)) return 'phone';
  return 'computer';
}
/** "Chrome on Windows (computer)" from the User-Agent (a label for the log; the header can be changed). */
function clientLabel(req) {
  const ua = String(req?.headers?.['user-agent'] || '');
  if (!ua) return 'unknown client';
  const os = /Windows/i.test(ua) ? 'Windows' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Mac OS X/i.test(ua) ? 'macOS'
    : /Android/i.test(ua) ? 'Android' : /Linux/i.test(ua) ? 'Linux' : 'unknown OS';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'unknown browser';
  return `${browser} on ${os} (${deviceType(req) || 'unknown device'})`;
}
module.exports = { deviceType, clientLabel };
