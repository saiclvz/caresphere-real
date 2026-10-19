import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Leaf, Menu, Users, X } from 'lucide-react';
import Logo, { LogoMark } from '../components/Logo';
import DisplaySettings from '../components/DisplaySettings';
import './home.css';

/*
 * The public pages' shared look (home page, Sign in, Create an account): top bar, illustration, features and
 * footer. Styles and tokens: home.css (scoped to .cs-home).
 */

/** Home page sections reached from the top bar (About, Support and Contact are sections of this page). */
export const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'support', label: 'Support' },
  { id: 'contact', label: 'Contact' },
];

export const FEATURES = [
  { Icon: Heart, title: 'Provide Care', text: 'Help children feel safe and valued.' },
  { Icon: Users, title: 'Build Futures', text: 'Support education, health and growth.' },
  { Icon: Leaf, title: 'Create Change', text: 'Be part of something bigger.' },
];

/**
 * Which section is being read, so its link in the top bar is marked as current: the last section whose top has
 * passed a third of the way down the screen (the last one at the bottom of the page).
 */
function useCurrentSection(enabled = true) {
  const [current, setCurrent] = useState('home');
  useEffect(() => {
    if (!enabled) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let id = NAV[0].id;
      for (const n of NAV) {
        const el = document.getElementById(n.id);
        if (el && el.getBoundingClientRect().top <= window.innerHeight / 3) id = n.id;
      }
      setCurrent(atBottom ? NAV[NAV.length - 1].id : id);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [enabled]);
  return [current, setCurrent];
}

/**
 * White top bar: logo | Child Welfare Home on the left; Home, About, Support, Contact on the right. On the home page
 * the links scroll to its sections (the current one is underlined); on Sign in / Create an account they open those
 * sections of the home page.
 */
export function PublicNav({ onHome = false }) {
  const [tracked, setCurrent] = useCurrentSection(onHome);
  const current = onHome ? tracked : null;
  const NavEl = onHome ? 'a' : Link; // in-page anchors on the home page; app links elsewhere
  const [open, setOpen] = useState(false);
  const menuId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const link = (n, mobile = false) => (
    <NavEl key={n.id} {...(onHome ? { href: `#${n.id}` } : { to: n.id === 'home' ? '/' : `/#${n.id}` })} aria-current={current === n.id ? 'true' : undefined}
      onClick={() => { setCurrent(n.id); setOpen(false); }}
      className={mobile
        ? `home-focus block rounded-[var(--home-control-radius)] px-3 py-2.5 text-sm font-medium ${current === n.id ? 'bg-[var(--home-panel)] text-[var(--home-link)]' : 'text-[var(--home-heading)] hover:bg-[var(--home-bg)]'}`
        : `home-navlink home-focus rounded-lg text-sm font-medium ${current === n.id ? 'text-[var(--home-link)]' : 'text-[var(--home-heading)] hover:text-[var(--home-link)]'}`}>
      {n.label}
    </NavEl>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--home-border)] bg-white">
      <div className="public-container public-header__bar">
        <Link to="/" className="public-brand home-focus rounded-lg" aria-label="CareSphere, Child Welfare Home: home">
          <span className="hidden sm:flex"><Logo variant="compact" theme="auto" /></span>
          <span className="flex sm:hidden"><LogoMark size={36} theme="auto" decorative /></span>
          <span aria-hidden className="public-brand__divider hidden min-[420px]:block" />
          <span className="hidden truncate text-sm font-medium text-[var(--home-muted)] min-[420px]:block">Child Welfare Home</span>
        </Link>
        <div className="public-header__end">
          <nav className="public-nav hidden md:flex" aria-label="Home page">
            {NAV.map((n) => link(n))}
          </nav>
          <DisplaySettings />
          <button type="button" className="home-focus rounded-[var(--home-control-radius)] p-2 text-[var(--home-heading)] hover:bg-[var(--home-bg)] md:hidden"
            aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
      </div>
      {open && (
        <nav id={menuId} className="border-t border-[var(--home-border)] bg-white py-2 md:hidden" aria-label="Home page">
          <div className="public-container">{NAV.map((n) => link(n, true))}</div>
        </nav>
      )}
    </header>
  );
}

/**
 * Original illustration (no photographs of children): an adult and a child walking hand in hand toward a home under
 * a rising sun, in the CareSphere blues. Faceless, simple shapes; blends into the light-blue hero.
 */
export function HopeIllustration({ className = '' }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 480 420" className={className} role="img" aria-labelledby={`${id}-t`}>
      <title id={`${id}-t`}>Illustration: an adult and a child walk hand in hand toward a home under a rising sun.</title>
      <defs>
        <radialGradient id={`${id}-fade`} cx="50%" cy="48%" r="58%">
          <stop offset="70%" stopColor="#fff" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-m`}><rect width="480" height="420" fill={`url(#${id}-fade)`} /></mask>
      </defs>
      <g mask={`url(#${id}-m)`}>
        <rect width="480" height="420" style={{ fill: 'var(--home-panel, #E3EFFE)' }} />
        {/* morning sun and rays (right half: the login card covers the left part on wide screens) */}
        <circle cx="352" cy="140" r="92" fill="#FFF1D6" />
        <circle cx="352" cy="140" r="62" fill="#FFE4AD" />
        <g stroke="#FFE4AD" strokeWidth="6" strokeLinecap="round" opacity="0.9">
          <path d="M352 24v22M352 234v22M236 140h22M446 140h22M270 58l16 16M418 206l16 16M434 58l-16 16M286 206l-16 16" />
        </g>
        {/* hills */}
        <path d="M0 300 C90 250 170 262 250 288 C330 314 400 282 480 258 V420 H0Z" fill="#C6D8F7" />
        <path d="M0 340 C110 304 210 318 300 340 C380 360 430 336 480 322 V420 H0Z" fill="#9DBCF0" />
        {/* path to the house */}
        <path d="M250 420 C290 380 350 340 400 300" fill="none" stroke="#FFFFFF" strokeWidth="18" strokeLinecap="round" opacity="0.85" />
        {/* tree */}
        <rect x="452" y="226" width="10" height="62" rx="5" fill="#51607F" />
        <circle cx="457" cy="216" r="28" fill="#7FA8F0" />
        <circle cx="440" cy="232" r="18" fill="#9DBCF0" />
        {/* house with a heart */}
        <rect x="364" y="232" width="78" height="64" rx="6" fill="#FFFFFF" stroke="#1B5FD1" strokeWidth="4" />
        <path d="M354 238 L403 196 L452 238" fill="none" stroke="#1B2A6B" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="392" y="262" width="22" height="34" rx="4" fill="#E3EFFE" stroke="#1B5FD1" strokeWidth="3" />
        <rect x="374" y="248" width="14" height="12" rx="2" fill="#C6D8F7" />
        <rect x="418" y="248" width="14" height="12" rx="2" fill="#C6D8F7" />
        <path d="M403 186 C394 179 390 173 393.5 168 C396.3 164 401.6 164.6 403 168.5 C404.4 164.6 409.7 164 412.5 168 C416 173 412 179 403 186Z" fill="#1D5FD6" />
        {/* adult and child, hand in hand, walking toward the house */}
        <g transform="translate(104 4)">
          <circle cx="168" cy="262" r="15" fill="#1B2A6B" />
          <path d="M150 282 C150 278 156 276 168 276 C180 276 186 278 186 282 L190 336 C190 340 186 342 182 342 L154 342 C150 342 146 340 146 336Z" fill="#1B2A6B" />
          <rect x="152" y="340" width="10" height="38" rx="5" fill="#1B2A6B" />
          <rect x="174" y="340" width="10" height="38" rx="5" fill="#1B2A6B" />
          <path d="M186 292 C196 300 204 306 214 310" fill="none" stroke="#1B2A6B" strokeWidth="9" strokeLinecap="round" />
          <circle cx="232" cy="292" r="11" fill="#1B5FD1" />
          <path d="M218 308 C218 305 224 304 232 304 C240 304 246 305 246 308 L249 344 C249 347 246 348 243 348 L221 348 C218 348 215 347 215 344Z" fill="#1B5FD1" />
          <rect x="222" y="346" width="8" height="28" rx="4" fill="#1B5FD1" />
          <rect x="235" y="346" width="8" height="28" rx="4" fill="#1B5FD1" />
          <path d="M218 312 C214 312 212 311 210 310" fill="none" stroke="#1B5FD1" strokeWidth="7" strokeLinecap="round" />
        </g>
        {/* birds */}
        <g fill="none" stroke="#51607F" strokeWidth="3" strokeLinecap="round">
          <path d="M206 90 q8 -8 16 0 q8 -8 16 0" />
          <path d="M248 64 q6 -6 12 0 q6 -6 12 0" />
        </g>
      </g>
    </svg>
  );
}

/** Light-blue footer: legal links centred, the copyright underneath. */
export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer__content">
        <nav aria-label="Legal" className="public-footer__links text-sm">
          <Link to="/privacy" className="home-focus rounded font-medium text-[var(--home-link)] underline-offset-2 hover:underline">Privacy Policy</Link>
          <span aria-hidden className="text-[var(--home-muted)]">|</span>
          <Link to="/terms" className="home-focus rounded font-medium text-[var(--home-link)] underline-offset-2 hover:underline">Terms and Conditions</Link>
        </nav>
        <p className="m-0 text-xs text-[var(--home-muted)]">© 2026 CareSphere</p>
      </div>
    </footer>
  );
}
