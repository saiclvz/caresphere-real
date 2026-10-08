import { QRCodeSVG } from 'qrcode.react';

/**
 * Shared QR code (adoption slips, staff application and child QR cards).
 * Encode only a link, never names, addresses or other personal data.
 */
export default function QrCode({ value, size = 160, label, className = '' }) {
  return (
    <QRCodeSVG value={value} size={size} level="M" marginSize={2} title={label} role="img" aria-label={label}
      className={`rounded bg-white ${className}`} />
  );
}
