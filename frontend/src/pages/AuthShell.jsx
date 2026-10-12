import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import Logo, { TAGLINE } from '../components/Logo';
import DisplaySettings from '../components/DisplaySettings';
import { HeroArt, HeroStatement } from '../components/brand/Hero';

/** Split-screen frame shared by sign-in and donor registration: brand panel + the form. */
export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-navy-900 via-navy-900 to-navy-950 p-12 text-white lg:flex">
        <HeroArt tone="dark" />
        <Link to="/" className="relative w-fit rounded-lg" aria-label="CareSphere home"><Logo variant="compact" theme="dark" /></Link>
        <div className="relative max-w-lg">
          <HeroStatement tone="dark" as="p" className="text-5xl xl:text-6xl" />
          <p className="mt-6 max-w-md text-base leading-relaxed text-slate-200">
            CareSphere helps the home's social workers and caregivers keep each child's records safe, private and in one place,
            so more time goes to the children.
          </p>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-slate-300">
          <ShieldCheck className="h-4 w-4 text-brand-400" aria-hidden />
          Runs on your local network. Child records stay in this facility.
        </p>
      </section>
      <section className="relative flex items-center justify-center bg-page px-6 py-12">
        <div className="absolute right-4 top-4"><DisplaySettings /></div>
        <div className="w-full max-w-sm animate-pop">
          {/* Small screens: the brand panel is hidden, so the logo and tagline sit above the form. */}
          <div className="mb-8 lg:hidden">
            <Link to="/" className="inline-block rounded-lg" aria-label="CareSphere home"><Logo variant="compact" /></Link>
            <p className="mt-3 font-display text-xl font-semibold text-navy-900">{TAGLINE}</p>
          </div>
          <h1 className="text-2xl font-semibold text-navy-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          <div className="mt-8 rounded-2xl border border-slate-200/70 bg-white p-6 shadow-card">{children}</div>
        </div>
      </section>
    </div>
  );
}
