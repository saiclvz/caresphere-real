import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FileCheck, HandHeart, Mail, MapPin, Phone, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { LogoMark, TAGLINE } from '../components/Logo';
import IconifyIcon from '../components/IconifyIcon';
import { LoginFlow } from './Login';
import { usePublicContact } from './Legal';
import { FEATURES, HopeIllustration, PublicFooter, PublicNav } from './PublicChrome';

/** What the system actually does (the three main areas staff work in). */
const CAPABILITIES = [
  { icon: 'lucide:shield-check', fallback: ShieldCheck, title: 'Secure Child Records', text: 'Child information is protected through role-based access, controlled permissions, and activity logging.' },
  { icon: 'lucide:users-round', fallback: UsersRound, title: 'Coordinated Case Management', text: 'Staff can manage assigned children, admission, case activities, meals, schedules, transition reviews, and adoption processes.' },
  { icon: 'lucide:file-check', fallback: FileCheck, title: 'Accountable Operations', text: 'Donations, inventory movements, staff activities, and important case actions are recorded for monitoring and accountability.' },
];

const btn = 'home-focus inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-[var(--home-control-radius)] px-5 text-sm font-semibold transition-colors';

/** The home page login card: the real sign-in flow (same form, validation, API call and two-step verification). */
function LoginCardFrame({ title, subtitle, children }) {
  return (
    <div className="home-login relative w-full rounded-[var(--home-card-radius)] border border-[var(--home-border)] bg-[var(--home-card)] p-6 shadow-[var(--home-shadow-raised)] sm:p-7">
      <h2 className="text-xl font-bold text-[var(--home-heading)]">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-[var(--home-muted)]">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </div>
  );
}

function Contact() {
  const c = usePublicContact() || {};
  const rows = [
    { Icon: MapPin, label: 'Our office', value: [c.org_name || 'CareSphere Child Welfare Home', c.org_address].filter(Boolean).join(', ') },
    { Icon: Phone, label: 'Phone', value: c.org_contact || c.dpo_phone || '09989239681' },
    { Icon: Mail, label: 'Email', value: c.dpo_email || 'capstonecaresphere@gmail.com', href: `mailto:${c.dpo_email || 'capstonecaresphere@gmail.com'}` },
    { Icon: UserRound, label: 'Data Protection Officer', value: c.dpo_name || 'CareSphere Capstone' },
  ];
  return (
    <address className="not-italic">
      <ul className="home-cards home-cards--2">
        {rows.map((r) => (
          <li key={r.label} className="flex min-w-0 items-start gap-3 rounded-[var(--home-card-radius)] border border-[var(--home-border)] bg-[var(--home-card)] p-4 shadow-[var(--home-shadow)]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--home-panel)] text-[var(--home-link)]"><r.Icon className="h-5 w-5" aria-hidden /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--home-heading)]">{r.label}</span>
              {r.href ? <a href={r.href} className="home-focus break-all rounded text-sm text-[var(--home-link)] underline underline-offset-2">{r.value}</a>
                : <span className="block break-words text-sm text-[var(--home-muted)]">{r.value}</span>}
            </span>
          </li>
        ))}
      </ul>
    </address>
  );
}

function SectionTitle({ id, eyebrow, title, children, flush = false }) {
  return (
    <div className={flush ? 'min-w-0' : 'mb-6'}>
      <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--home-link)]"><span aria-hidden className="h-px w-8 bg-[var(--home-primary)]" />{eyebrow}</p>
      <h2 id={id} className="mt-2 text-2xl font-bold text-[var(--home-heading)] sm:text-[1.75rem]">{title}</h2>
      {children && <p className="mt-1.5 max-w-2xl text-[var(--home-muted)]">{children}</p>}
    </div>
  );
}

/** Public home page (signed out). */
export default function Landing() {
  // Arriving from Sign in / Create an account with /#about etc.: go to that section.
  const { hash } = useLocation();
  useEffect(() => {
    const id = hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [hash]);
  return (
    <div className="cs-home public-page">
      <a href="#landing-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-modal">Skip to main content</a>
      <PublicNav onHome />

      <main id="landing-main">
        {/* Hero */}
        <section id="home" aria-labelledby="home-title" className="home-hero overflow-hidden border-b border-[var(--home-border)] bg-[var(--home-panel)]">
          <div className="public-container home-hero__grid">
            <div>
              <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--home-link)]"><span aria-hidden className="h-px w-8 bg-[var(--home-primary)]" />Together for a brighter future</p>
              <h1 id="home-title" className="mt-4 text-[2.25rem] font-extrabold leading-[1.1] tracking-tight text-[var(--home-heading)] sm:text-5xl lg:text-[3.25rem]">
                Support Children.<br />Change Lives.
              </h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-[var(--home-muted)] sm:text-lg">
                CareSphere connects caring people with children in need. Your support helps provide safety, stability, and brighter futures.
              </p>
              <ul className="mt-9 grid max-w-xl grid-cols-1 gap-6 min-[400px]:grid-cols-3 min-[400px]:gap-4">
                {FEATURES.map((f) => (
                  <li key={f.title} className="flex flex-row items-start gap-3 text-left min-[400px]:flex-col min-[400px]:items-center min-[400px]:text-center">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-[var(--home-link)] shadow-[var(--home-shadow)] ring-1 ring-[var(--home-border)]"><f.Icon className="h-5 w-5" aria-hidden strokeWidth={2} /></span>
                    <span>
                      <span className="block text-sm font-bold text-[var(--home-heading)] min-[400px]:mt-2">{f.title}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-[var(--home-muted)] sm:text-[0.8125rem]">{f.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Login card and illustration side by side in their own grid (stacked on phones), vertically centred. */}
            <div className="home-hero__media">
              <div className="home-hero__card">
                <LoginFlow Frame={LoginCardFrame} title="Donor Login" subtitle="Login to your CareSphere donor account." idPrefix="home-login" />
              </div>
              <HopeIllustration className="home-hero__art" />
            </div>
          </div>
        </section>

        {/* About */}
        <section id="about" aria-labelledby="about-title" className="home-section">
          <div className="public-container">
          <SectionTitle id="about-title" eyebrow="About CareSphere" title="Our mission">
            CareSphere is the records and case management system of a residential child-care facility.
          </SectionTitle>
          <div className="grid items-center gap-8 rounded-[var(--home-card-radius)] border border-[var(--home-border)] bg-[var(--home-card)] p-6 shadow-[var(--home-shadow)] sm:p-8 md:grid-cols-[auto_1fr]">
            <LogoMark size={104} theme="auto" decorative className="mx-auto" />
            <div>
              <p className="font-display text-2xl font-bold text-[var(--home-heading)] sm:text-3xl">{TAGLINE}</p>
              <p className="mt-3 max-w-2xl leading-relaxed text-[var(--home-muted)]">
                Every record in CareSphere stands for a child. The system keeps their story safe, helps the team care for them
                day to day, and supports the path to a permanent, loving family.
              </p>
            </div>
          </div>
          <ul className="home-cards home-cards--3 mt-6">
            {CAPABILITIES.map((c) => (
              <li key={c.title} className="rounded-[var(--home-card-radius)] border border-[var(--home-border)] bg-[var(--home-card)] p-5 shadow-[var(--home-shadow)]">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--home-panel)] text-[var(--home-link)]"><IconifyIcon icon={c.icon} fallback={c.fallback} size={22} /></span>
                <h3 className="mt-3 font-semibold text-[var(--home-heading)]">{c.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--home-muted)]">{c.text}</p>
              </li>
            ))}
          </ul>
          </div>
        </section>

        {/* Support */}
        <section id="support" aria-labelledby="support-title" className="home-section border-y border-[var(--home-border)] bg-white">
          <div className="public-container">
            <div className="home-support rounded-[var(--home-card-radius)] border border-[var(--home-border)] bg-[var(--home-panel)] p-6 sm:p-8">
              <SectionTitle id="support-title" eyebrow="Get help and support" title="Support the home" flush>
                Donors give supplies and funds the home needs, and can follow their donations and receipts in their donor account.
              </SectionTitle>
              <Link to="/register" className={`${btn} shrink-0 bg-[var(--home-primary)] text-white hover:bg-[var(--home-primary-hover)]`}><HandHeart className="h-4 w-4" aria-hidden />Support the home</Link>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section id="contact" aria-labelledby="contact-title" className="home-section">
          <div className="public-container">
          <SectionTitle id="contact-title" eyebrow="Get in touch" title="Contact us">
            Questions about the home, donations or your personal information.
          </SectionTitle>
          <Contact />
          <p className="mt-8 flex items-center gap-2 text-sm text-[var(--home-muted)]"><ShieldCheck className="h-4 w-4 shrink-0 text-[var(--home-link)]" aria-hidden />Runs on the home's local network. Child records stay in this facility.</p>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
