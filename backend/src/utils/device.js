/** Device type from the browser's User-Agent, for the audit log: phone, tablet or computer. */
function deviceType(req) {
  const ua = String(req?.headers?.['user-agent'] || '');
  if (!ua) return null;
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i.test(ua)) return 'phone';
  return 'computer';
}
module.exports = { deviceType };
