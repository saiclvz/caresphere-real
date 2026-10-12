/**
 * A short description of this browser and device for the watermark and the capture log, e.g.
 * "Chrome on Windows (computer)". It comes from the User-Agent, which the user can change, so it is a
 * label for the record, not proof of anything.
 */
export function clientInfo() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const os = /Windows/i.test(ua) ? 'Windows' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Mac OS X/i.test(ua) ? 'macOS'
    : /Android/i.test(ua) ? 'Android' : /Linux/i.test(ua) ? 'Linux' : 'Unknown OS';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
  const device = /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua) ? 'tablet' : /Mobi|iPhone|iPod|Android/i.test(ua) ? 'phone' : 'computer';
  return { os, browser, device, label: `${browser} on ${os} (${device})` };
}
