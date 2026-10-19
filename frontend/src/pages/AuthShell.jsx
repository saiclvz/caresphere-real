import { ShieldCheck } from 'lucide-react';
import { TAGLINE } from '../components/Logo';
import { FEATURES, HopeIllustration, PublicFooter, PublicNav } from './PublicChrome';

/**
 * Frame shared by Sign in and Create an account (and the two-step verification steps): the home page's look, with
 * the white top bar, the light-blue band with the brand message and illustration, the form in a white card, and the
 * light-blue footer. Only the frame; the forms inside are unchanged.
 */
export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="cs-home public-page">
      <a href="#auth-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-modal">Skip to main content</a>
      <PublicNav />
      <main id="auth-main" className="bg-[var(--home-panel)]">
        <div className="public-container auth-grid">
          {/* Brand message (wide screens; on phones the card comes first and this follows it). */}
          <section className="order-2 lg:order-1" aria-label="About CareSphere">
            <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--home-link)]"><span aria-hidden className="h-px w-8 bg-[var(--home-primary)]" />Together for a brighter future</p>
            <p className="mt-4 text-3xl font-extrabold leading-[1.15] tracking-tight text-[var(--home-heading)] sm:text-4xl">{TAGLINE}</p>
            <p className="mt-4 max-w-lg leading-relaxed text-[var(--home-muted)]">
              CareSphere helps the home's social workers and caregivers keep each child's records safe, private and in one place,
              so more time goes to the children.
            </p>
            <ul className="mt-7 grid max-w-xl grid-cols-1 gap-5 min-[400px]:grid-cols-3 min-[400px]:gap-4">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex flex-row items-start gap-3 text-left min-[400px]:flex-col min-[400px]:items-center min-[400px]:text-center">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-[var(--home-link)] shadow-[var(--home-shadow)] ring-1 ring-[var(--home-border)]"><f.Icon className="h-5 w-5" aria-hidden /></span>
                  <span>
                    <span className="block text-sm font-bold text-[var(--home-heading)] min-[400px]:mt-2">{f.title}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-[var(--home-muted)] sm:text-[0.8125rem]">{f.text}</span>
                  </span>
                </li>
              ))}
            </ul>
            <HopeIllustration className="mt-6 hidden w-full max-w-sm lg:block" />
            <p className="mt-4 flex items-center gap-2 text-sm text-[var(--home-muted)]">
              <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--home-link)]" aria-hidden />
              Runs on your local network. Child records stay in this facility.
            </p>
          </section>

          {/* The form card (same white card as the home page's Donor Login). */}
          <div className="home-login order-1 w-full animate-pop rounded-[var(--home-card-radius)] border border-[var(--home-border)] bg-[var(--home-card)] p-6 shadow-[var(--home-shadow-raised)] sm:p-8 lg:order-2">
            <h1 className="text-2xl font-bold text-[var(--home-heading)]">{title}</h1>
            {subtitle && <p className="mt-1 text-sm leading-relaxed text-[var(--home-muted)]">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
