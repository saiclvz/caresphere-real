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
 * Decorative background for brand panels: soft light, the CareSphere ring and a large faint mark
 * (home, family and caring hands). Purely decorative, hidden from screen readers.
 */
export function HeroArt({ tone = 'dark', feature = false }) {
  const dark = tone === 'dark';
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className={`absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full blur-3xl ${dark ? 'bg-brand/25' : 'bg-brand-100'}`} />
      <div className={`absolute -bottom-40 right-[-6rem] h-[30rem] w-[30rem] rounded-full blur-3xl ${dark ? 'bg-brand-400/15' : 'bg-brand-50'}`} />
      {feature ? (
        // Landing page: the family-and-home mark as the hero picture, on a soft light circle.
        <div className="absolute right-[-4rem] top-1/2 hidden -translate-y-1/2 lg:block xl:right-[2%]">
          <div className="flex h-[30rem] w-[30rem] items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-white/10">
            <div className="opacity-[0.22]"><LogoMark size={380} theme="dark" decorative /></div>
          </div>
        </div>
      ) : (
        <div className={`absolute -right-24 bottom-[-5rem] ${dark ? 'opacity-[0.09]' : 'opacity-[0.07]'}`}>
          <LogoMark size={520} theme={dark ? 'dark' : 'light'} decorative />
        </div>
      )}
    </div>
  );
}
