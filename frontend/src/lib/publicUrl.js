/**
 * Base URL printed inside QR codes, e.g. http://192.168.1.20:5173
 *
 * A phone scanning a printed QR code can't open "localhost" (that would be the phone itself),
 * so set VITE_PUBLIC_BASE_URL in frontend/.env to the server's LAN address or real domain.
 * Without it, the address in the browser bar is used, which is fine when staff open
 * CareSphere through the LAN IP, but wrong when they use localhost on the server PC.
 */
export function publicBaseUrl() {
  const configured = String(import.meta.env.VITE_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return configured || window.location.origin;
}
