import { Link } from 'react-router-dom';
import { HandHeart, HeartHandshake, LockKeyhole, ShieldCheck, Users } from 'lucide-react';
import Logo, { LogoMark, TAGLINE } from '../components/Logo';
import DisplaySettings from '../components/DisplaySettings';
import { HeroArt, HeroStatement } from '../components/brand/Hero';

const btn = 'inline-flex min-h-[2.75rem] items-center justify-center rounded-lg px-5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

const VALUES = [
  { icon: LockKeyhole, title: 'Safe and private', text: 'Health, adoption and transition records open only for assigned staff, for a stated purpose, after a QR check. Every view is logged.' },
  { icon: Users, title: 'Care, coordinated', text: 'Children, staff schedules, meals, inventory and visitors in one place, so caregivers spend less time on paperwork.' },
  { icon: HeartHandshake, title: 'Families and supporters', text: 'Donors can give and follow their donations, and families can apply to adopt through the administrative adoption process under RA 11642.' },
];

/** Public home page (signed out). Sign-in and sign-up stay one click away. */
export default function Landing() {
  return (
    <div className="min-h-screen bg-page">
      <a href="#landing-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-modal">Skip to main content</a>
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="rounded-lg" aria-label="CareSphere home">
            <span className="hidden sm:block"><Logo variant="compact" /></span>
            <span className="sm:hidden"><LogoMark size={36} decorative /></span>
          </Link>
          <nav className="ml-auto flex items-center gap-2" aria-label="Account">
            <DisplaySettings />
            <Link to="/login" className={`${btn} text-navy-900 hover:bg-brand-50 focus-visible:ring-brand`}>Sign in</Link>
            <Link to="/register" className={`${btn} bg-brand text-white hover:bg-brand-dark focus-visible:ring-brand`}>Sign up</Link>
          </nav>
        </div>
      </header>

      <main id="landing-main">
        <section className="relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-900 to-navy-950 text-white">
          <HeroArt tone="dark" feature />
          <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
            <div>
              <HeroStatement tone="dark" className="text-5xl sm:text-6xl lg:text-7xl" />
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-200">
                CareSphere supports the people who look after children in residential care: social workers, caregivers,
                families and donors, with records kept safe and private.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/register" className={`${btn} bg-white text-navy-900 hover:bg-brand-50 focus-visible:ring-white focus-visible:ring-offset-navy-900`}>Create a donor account</Link>
                <Link to="/login" className={`${btn} border border-white/40 text-white hover:bg-white/10 focus-visible:ring-white focus-visible:ring-offset-navy-900`}>Sign in</Link>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="values">
          <h2 id="values" className="font-display text-3xl font-bold text-navy-900">Technology that supports care</h2>
          <p className="mt-2 max-w-2xl text-slate-600">Built for a child welfare home: careful with children's information, simple for the team.</p>
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {VALUES.map((v) => (
              <li key={v.title} className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-card transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-lift">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand"><v.icon className="h-5 w-5" aria-hidden /></span>
                <h3 className="mt-4 font-semibold text-navy-900">{v.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{v.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-y border-slate-200/70 bg-white" aria-labelledby="mission">
          <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-16 sm:px-6 md:grid-cols-[auto_1fr]">
            <LogoMark size={120} decorative className="mx-auto" />
            <div>
              <h2 id="mission" className="text-sm font-semibold uppercase tracking-wide text-brand">Our mission</h2>
              <p className="mt-2 font-display text-3xl font-bold text-navy-900 sm:text-4xl">{TAGLINE}</p>
              <p className="mt-3 max-w-2xl text-slate-600">
                Every record in CareSphere stands for a child. The system keeps their story safe, helps the team care for them
                day to day, and supports the path to a permanent, loving family.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/register" className={`${btn} bg-brand text-white hover:bg-brand-dark focus-visible:ring-brand`}><HandHeart className="mr-2 h-4 w-4" aria-hidden />Support the home</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-xs text-slate-600 sm:px-6">
        <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand" aria-hidden />Runs on the home's local network. Child records stay in this facility.</span>
      </footer>
    </div>
  );
}
