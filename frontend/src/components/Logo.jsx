// Logo.jsx: CareSphere logo (mark + two-tone wordmark + tagline), reusable everywhere.
//
// <Logo variant="full" />                       sign in / sign up pages, printed passes, report headers
// <Logo variant="stacked" />                    narrow cards, loading screen
// <Logo variant="compact" theme="dark" />       sidebar (dark navy background)
// <Logo variant="mark" theme="dark" />          collapsed sidebar, small spaces
//
// Wordmark font: Playfair Display, loaded in index.html (falls back to Georgia without internet).

export const TAGLINE = "Every child deserves a loving home.";

const THEMES = {
  light: { navy: "#1B2A6B", blue: "#1D5FD6", side: "#2F4FB0", tag: "#1B2A6B" },
  dark:  { navy: "#FFFFFF", blue: "#60A5FA", side: "#BFDBFE", tag: "#CBD5E1" },
};

export function LogoMark({ size = 40, theme = "light", className = "", decorative = false }) {
  const c = THEMES[theme];
  const a11y = decorative ? { "aria-hidden": true, focusable: "false" } : { role: "img", "aria-label": "CareSphere" };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" {...a11y} className={`shrink-0 ${className}`}>
      {/* ring with a gap for the heart */}
      <path d="M90.8 33.5 A44 44 0 1 1 70.6 11.1" fill="none" stroke={c.navy} strokeWidth="5" strokeLinecap="round" />
      {/* roof */}
      <path d="M27 42 L50 22 L73 42" fill="none" stroke={c.navy} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* people */}
      <circle cx="37.5" cy="47" r="4.2" fill={c.side} />
      <path d="M30 63 C30 55 33 52 37.5 52 C41 52 43 54 44 57 L44 63Z" fill={c.side} />
      <circle cx="62.5" cy="47" r="4.2" fill={c.side} />
      <path d="M70 63 C70 55 67 52 62.5 52 C59 52 57 54 56 57 L56 63Z" fill={c.side} />
      <circle cx="50" cy="41" r="5.2" fill={c.blue} />
      <path d="M41 63 C41 53 45 49 50 49 C55 49 59 53 59 63Z" fill={c.blue} />
      {/* cupped hands */}
      <path d="M18 66 Q22 84 50 84 Q78 84 82 66 Q66 76 50 76 Q34 76 18 66Z" fill={c.navy} />
      {/* heart */}
      <path d="M80 30 C73 25 70 21 72.5 17.5 C74.5 14.5 78.5 15 80 18 C81.5 15 85.5 14.5 87.5 17.5 C90 21 87 25 80 30Z" fill={c.blue} />
    </svg>
  );
}

export default function Logo({ variant = "full", theme = "light", showTagline, size, className = "" }) {
  const c = THEMES[theme];
  if (variant === "mark") return <LogoMark size={size || 36} theme={theme} className={className} />;

  const cfg = {
    full:    { mark: 72, word: 40, tag: 11, row: true,  tagline: true  },
    compact: { mark: 36, word: 20, tag: 9,  row: true,  tagline: false },
    stacked: { mark: 80, word: 34, tag: 11, row: false, tagline: true  },
  }[variant];
  const withTag = showTagline ?? cfg.tagline;

  return (
    <div className={`inline-flex items-center gap-3 ${cfg.row ? "flex-row" : "flex-col text-center"} ${className}`}>
      <LogoMark size={cfg.mark} theme={theme} decorative />
      <div className="leading-none">
        <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: cfg.word, fontWeight: 700, letterSpacing: "-0.01em" }}>
          <span className="sr-only">CareSphere</span>
          <span aria-hidden="true" style={{ color: c.navy }}>Care</span><span aria-hidden="true" style={{ color: c.blue }}>Sphere</span>
        </div>
        {withTag && (
          <div style={{ fontSize: cfg.tag, color: c.tag, marginTop: 6, fontWeight: 500 }}>{TAGLINE}</div>
        )}
      </div>
    </div>
  );
}
