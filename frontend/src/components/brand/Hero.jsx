import { LogoMark } from '../Logo';

/**
 * The brand statement "Every child / deserves / a loving home." in the serif display face.
 * tone="dark" for navy backgrounds (accessible light blue for the last line), "light" for white.
 */
export function HeroStatement({ tone = 'light', as: Tag = 'h1', className = '' }) {
  const base = tone === 'dark' ? 'text-white' : 'text-navy-900';
  const accent = tone === 'dark' ? 'text-brand-400' : 'text-brand';
  return (
    <Tag className={`font-display font-bold leading-[1.05] ${base} ${className}`}>
      Every child<br />deserves<br /><span className={accent}>a loving home.</span>
    </Tag>
  );
}

/**
 * Quiet background for the sign-in panel: a faint CareSphere mark in the corner (no glows or floating shapes).
 * Purely decorative, hidden from screen readers.
 */
export function HeroArt({ tone = 'dark' }) {
  const dark = tone === 'dark';
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className={`absolute -right-24 bottom-[-5rem] ${dark ? 'opacity-[0.07]' : 'opacity-[0.05]'}`}>
        <LogoMark size={460} theme={dark ? 'dark' : 'auto'} decorative />
      </div>
    </div>
  );
}
