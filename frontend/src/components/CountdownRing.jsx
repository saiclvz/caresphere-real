/** Circular countdown used by the QR health gateway and QR station. */
export default function CountdownRing({ remaining, total = 180, size = 72, light = false }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, remaining / total));
  const urgent = remaining <= 30;
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, '0');
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="timer" aria-label={`${mm} minutes ${ss} seconds remaining`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={light ? 'rgba(255,255,255,0.15)' : '#E2E8F0'} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          stroke={urgent ? '#F59E0B' : '#2563EB'} strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 1s linear' }} />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums ${light ? 'text-white' : 'text-navy-900'}`}>
        {mm}:{ss}
      </span>
    </div>
  );
}
