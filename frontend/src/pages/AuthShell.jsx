import { ShieldCheck } from 'lucide-react';

/** Split-screen frame shared by sign-in and donor registration. */
export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-navy-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800"><ShieldCheck className="h-5 w-5 text-brand" /></div>
          <span className="text-lg font-semibold">CareSphere</span>
        </div>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-snug">Every child's record in one place, and their health history behind a code only the right person can scan.</p>
          <p className="mt-4 text-slate-400">Registry, inventory, donations, visitors, meals and schedules for welfare home teams on your local network.</p>
        </div>
        <svg className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 text-navy-800" viewBox="0 0 100 100" aria-hidden>
          {[...Array(7)].map((_, r) => [...Array(7)].map((__, c) => ((r * 7 + c) * 37) % 3 !== 0 && (
            <rect key={`${r}-${c}`} x={c * 14} y={r * 14} width="11" height="11" rx="2" fill="currentColor" />
          )))}
        </svg>
        <p className="text-xs text-slate-500">Runs on your local network. No data leaves this facility.</p>
      </section>
      <section className="flex items-center justify-center bg-page px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold text-navy-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  );
}
