import { Children, cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, HeartHandshake, Info, Inbox, Loader2, SearchX, ShieldOff, X } from 'lucide-react';
import { iconFor, sectionFor } from '../lib/sections';

/** Standard wording for shared states (kept in one place). */
export const MESSAGES = {
  loading: 'Loading information...',
  empty: 'No records found.',
  error: 'Something went wrong. Please try again.',
  denied: 'Access denied – You are not authorized to view this information.',
  invalid: 'Please correct the highlighted information.',
  saved: 'Your changes have been saved successfully.',
};

/**
 * Button. variant: primary | outline (alias secondary) | ghost | danger | dark. size: sm | md | lg. loading shows a
 * spinner, disables the button and sets aria-busy. type defaults to "button" (pass type="submit" in forms).
 */
export function Button({ variant = 'primary', size = 'md', loading, className = '', children, ...props }) {
  const variants = {
    primary: 'bg-brand text-white shadow-sm hover:bg-brand-dark active:bg-brand-800 disabled:bg-brand/45 disabled:shadow-none',
    secondary: 'bg-white text-navy-900 border border-slate-300 hover:border-brand hover:bg-brand-50 active:bg-brand-100 disabled:bg-white disabled:text-slate-300 disabled:border-slate-200',
    outline: 'bg-white text-navy-900 border border-slate-300 hover:border-brand hover:bg-brand-50 active:bg-brand-100 disabled:bg-white disabled:text-slate-300 disabled:border-slate-200',
    danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 disabled:bg-red-300',
    ghost: 'text-slate-600 hover:bg-brand-50 hover:text-navy-900 active:bg-brand-100 disabled:text-slate-300',
    dark: 'bg-navy-900 text-white hover:bg-navy-800 active:bg-navy-950',
  };
  const sizes = { sm: 'min-h-[2rem] px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' };
  return (
    <button
      type="button"
      disabled={loading || props.disabled}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-[2.25rem] items-center justify-center gap-2 rounded-xl font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 enabled:active:translate-y-px disabled:cursor-not-allowed ${variants[variant] || variants.primary} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** A card. interactive: lifts on hover/focus (use for clickable cards). */
export function Card({ className = '', interactive = false, children, ...props }) {
  const hover = interactive ? 'transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-lift focus-within:shadow-lift' : '';
  return <div className={`rounded-2xl border border-slate-200 bg-white shadow-card ${hover} ${className}`} {...props}>{children}</div>;
}

/**
 * Dashboard welcome: greeting, a short description and the CareSphere tagline on the light-blue header band.
 * Used on the dashboards only (the tagline isn't repeated on every page).
 */
export function WelcomeBanner({ title, description, actions, tagline = 'Every child deserves a loving home.' }) {
  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl border border-brand-200/70 bg-brand-100 px-5 py-6 shadow-card sm:px-7">
      <HeartHandshake className="pointer-events-none absolute -right-3 -top-3 h-32 w-32 text-brand/[0.08]" aria-hidden strokeWidth={1.25} />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-3 font-display text-sm font-semibold text-brand"><span aria-hidden className="h-px w-8 shrink-0 bg-brand" />{tagline}</p>
          <h1 className="mt-1 text-[1.625rem] font-bold tracking-tight text-navy-900 sm:text-[1.75rem]">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </section>
  );
}

/**
 * Standard page header: section (from the sidebar group, or `section`), title, short description, then the page's
 * actions on the right (below on phones). Pass section={false} to hide the section line.
 */
export function PageHeader({ title, description, actions, section, icon }) {
  const { pathname } = useLocation();
  const eyebrow = section === false ? null : section || sectionFor(pathname);
  const Icon = icon || iconFor(pathname);
  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-brand-200/70 bg-brand-100 px-5 pb-5 pt-6 sm:px-7">
      {Icon && <Icon className="pointer-events-none absolute -bottom-4 right-4 h-28 w-28 text-brand/[0.08] sm:right-8" aria-hidden strokeWidth={1.25} />}
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="mb-1.5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-brand"><span aria-hidden className="h-px w-8 shrink-0 bg-brand" />{eyebrow}</p>}
          <h1 className="text-[1.625rem] font-bold leading-tight tracking-tight text-navy-900 sm:text-[1.75rem]">{title}</h1>
          {description && <p className="mt-1.5 max-w-3xl text-sm text-slate-600 sm:text-[0.9375rem]">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * A small square icon button (row actions). `label` is required: it is the accessible name and the tooltip.
 * tone: brand (blue outline, the main row action), neutral, danger. With `to` it is a link.
 */
export function IconButton({ icon: Icon, label, tone = 'neutral', to, className = '', ...props }) {
  const tones = {
    brand: 'border-brand bg-brand-50 text-brand hover:bg-brand-100',
    neutral: 'border-slate-300 bg-white text-slate-600 hover:border-brand/50 hover:bg-brand-50 hover:text-navy-900',
    danger: 'border-red-200 bg-white text-red-600 hover:border-red-300 hover:bg-red-50',
  };
  const cls = `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`;
  const inner = <><Icon className="h-4 w-4" aria-hidden /><span className="sr-only">{label}</span></>;
  return to ? <Link to={to} title={label} className={cls} {...props}>{inner}</Link>
    : <button type="button" title={label} className={cls} {...props}>{inner}</button>;
}

/** A titled section inside a page (h2): title, short description and the section's actions. */
export function SectionHeader({ title, description, actions, className = '' }) {
  return (
    <div className={`mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
        {description && <p className="mt-0.5 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Class for one underline tab (the same look as <Tabs>), for pages that render their own tab buttons. */
export const tabClass = (on) => `-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${on ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-navy-900'}`;
/** Class for the tab row that holds tabClass buttons. */
export const TAB_ROW = 'relative mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200';

/**
 * Tabs that switch between views of one page (underline style, the same everywhere). tabs: [{ key, label, icon,
 * count }]. Arrow keys move between tabs. Pass `panelId` when the content has that id.
 */
export function Tabs({ tabs, value, onChange, label = 'Sections', className = '', panelId }) {
  const ref = useRef(null);
  const onKey = (e) => {
    const i = tabs.findIndex((t) => t.key === value);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    onChange(t.key);
    requestAnimationFrame(() => ref.current?.querySelector(`[data-key="${CSS.escape(t.key)}"]`)?.focus());
  };
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKey}
      className={`relative mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 ${className}`}>
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <button key={t.key} data-key={t.key} type="button" role="tab" aria-selected={on} aria-controls={panelId} tabIndex={on ? 0 : -1} onClick={() => onChange(t.key)}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${on ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-navy-900'}`}>
            {t.icon && <t.icon className="h-4 w-4" aria-hidden />}
            {t.label}
            {t.count !== undefined && t.count !== null && <span className={`rounded-full px-1.5 py-px text-xs tabular-nums ${on ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-600'}`}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Filter chips: pick one value to filter a list (status, role...). Same look on every page. options: [{ key, label,
 * count }]. The selected chip is navy with white text and is announced as pressed.
 */
export function FilterChips({ options, value, onChange, label = 'Filter', className = '' }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`} role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" aria-pressed={on} onClick={() => onChange(o.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${on ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:text-navy-900'}`}>
            {o.label}
            {o.count !== undefined && o.count !== null && <span className={`tabular-nums text-xs ${on ? 'text-white/80' : 'text-slate-500'}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A labelled form field. The error is shown with an icon and text (never colour alone), and a single
 * native input/select/textarea child gets aria-invalid and aria-describedby automatically.
 */
export function Field({ label, hint, error, required = false, children, className = '' }) {
  const id = useId();
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const only = Children.count(children) === 1 && isValidElement(children) && typeof children.type === 'string' ? children : null;
  const control = only ? cloneElement(only, {
    'aria-invalid': error ? true : only.props['aria-invalid'],
    'aria-describedby': [only.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
    'aria-required': required || only.props['aria-required'] || undefined,
  }) : children;
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-navy-800">
        {label}{required && <><span className="ml-0.5 text-red-600" aria-hidden="true">*</span><span className="sr-only"> (required)</span></>}
      </span>
      {control}
      {hint && !error && <span id={hintId} className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && (
        <span id={errorId} className="mt-1 flex items-start gap-1 text-xs font-medium text-red-700">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /><span>{error}</span>
        </span>
      )}
    </label>
  );
}

/**
 * An inline message with an icon and text: tone success | warning | error | info. Errors are announced
 * immediately (role=alert); the others politely (role=status).
 */
export function Notice({ tone = 'info', title, children, className = '' }) {
  const t = {
    success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', Icon: CheckCircle2, icon: 'text-emerald-700', label: 'Success' },
    warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', Icon: AlertTriangle, icon: 'text-amber-700', label: 'Warning' },
    error: { box: 'border-red-200 bg-red-50 text-red-900', Icon: AlertCircle, icon: 'text-red-700', label: 'Error' },
    info: { box: 'border-brand-200 bg-brand-50 text-navy-900', Icon: Info, icon: 'text-brand', label: 'Information' },
  }[tone];
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${t.box} ${className}`} role={tone === 'error' ? 'alert' : 'status'}>
      <t.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${t.icon}`} aria-hidden />
      <div className="min-w-0 flex-1"><span className="sr-only">{t.label}: </span>{title && <p className="font-semibold">{title}</p>}{children}</div>
    </div>
  );
}

export function Badge({ tone = 'slate', children, className = '' }) {
  // One status language everywhere: tinted background, matching outline, and the status written out (never colour alone).
  const tones = {
    slate: 'bg-slate-50 text-slate-700 ring-slate-300/70',
    blue: 'bg-brand-50 text-brand-800 ring-brand-200',
    green: 'bg-emerald-50 text-emerald-800 ring-emerald-600/25',
    amber: 'bg-amber-50 text-amber-800 ring-amber-600/30',
    red: 'bg-red-50 text-red-700 ring-red-600/25',
    navy: 'bg-navy-900 text-white ring-navy-900',
  };
  return <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone] || tones.slate} ${className}`}>{children}</span>;
}

export function Spinner({ label = MESSAGES.loading }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500" role="status" aria-live="polite">
      <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden /> {label}
    </div>
  );
}

/** Grey placeholder bars while a list or card loads (rows x one line each). */
export function Skeleton({ rows = 3, className = '' }) {
  return (
    <div className={`space-y-3 p-4 ${className}`} role="status" aria-live="polite">
      <span className="sr-only">{MESSAGES.loading}</span>
      {[...Array(rows)].map((_, i) => <div key={i} className="cs-skeleton h-4" style={{ width: `${92 - ((i * 17) % 35)}%` }} aria-hidden />)}
    </div>
  );
}

/**
 * An error with an icon and a Try again button. The server's own message is shown when it gives one
 * (for example "ACCESS DENIED – ..."); server faults and unknown errors show the standard wording,
 * so no internal detail leaks.
 */
export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  const status = Number(error.status || 0);
  const denied = status === 403;
  const message = status >= 500 && !error.message ? MESSAGES.error : (error.message || String(error) || MESSAGES.error);
  const Icon = denied ? ShieldOff : AlertCircle;
  return (
    <div className="flex animate-fade items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden />
      <div className="flex-1"><span className="sr-only">Error: </span>{message}</div>
      {onRetry && <button type="button" onClick={onRetry} className="shrink-0 rounded font-medium text-red-800 underline underline-offset-2 hover:text-red-950">Try again</button>}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title = MESSAGES.empty, description, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center" role="status">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100"><Icon className="h-7 w-7 text-brand" aria-hidden /></span>
      <p className="font-medium text-navy-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md', initialFocus = 'field' }) {
  const ref = useRef(null);
  const bodyRef = useRef(null);
  const titleId = useId();
  const opener = useRef(null);
  // Keep the latest onClose without re-running effects. Parents pass a new
  // arrow function on every render, so depending on it re-focused the modal
  // after every keystroke.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { onCloseRef.current?.(); return; }
      // Keep Tab focus inside the dialog while it is open.
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!ref.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus the first form field once, when the modal opens (not the close button), and give focus back
  // to whatever opened the modal when it closes.
  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    return () => { if (opener.current?.isConnected) opener.current.focus?.(); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const field = initialFocus === 'first' ? bodyRef.current?.querySelector('button:not([disabled]), input:not([type=hidden]):not([disabled])')
      : bodyRef.current?.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    (field || ref.current?.querySelector('button'))?.focus();
  }, [open]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', wide: 'max-w-4xl', xl: 'max-w-6xl' };
  return (
    <div className="fixed inset-0 z-50 flex animate-fade items-end justify-center bg-navy-950/55 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`flex max-h-[92vh] w-full ${widths[size]} animate-pop flex-col rounded-t-2xl bg-white shadow-modal sm:rounded-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-navy-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-brand-50 hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div ref={bodyRef} className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, title, message, confirmLabel = 'Delete', onConfirm, onClose, loading, children, confirmDisabled = false }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={loading} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      <p className="text-sm text-slate-600">{message}</p>
      {children}
    </Modal>
  );
}

/** A summary number. With `to` the whole tile is a link to the page that lists those records. */
export function StatTile({ icon: Icon, label, value, tone = 'blue', to, hint, interactive = false }) {
  // Light-blue circle for every tile; the tone only colours the icon (the label says what the number means).
  const tones = { blue: 'text-brand', amber: 'text-amber-700', green: 'text-emerald-700', slate: 'text-navy-800', red: 'text-red-700' };
  const body = (
    <Card interactive={Boolean(to) || interactive} className="flex h-full items-center gap-4 p-4 sm:p-5">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100 ${tones[tone] || tones.blue}`}><Icon className="h-5 w-5" aria-hidden /></div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <p className="text-2xl font-bold leading-tight tabular-nums text-navy-900">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
    </Card>
  );
  return to ? <Link to={to} className="block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">{body}</Link> : body;
}

/** Standard empty state when a search matches nothing. */
export function NoMatches() {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center" role="status">
      <SearchX className="mb-3 h-8 w-8 text-slate-300" aria-hidden />
      <p className="font-medium text-navy-900">No matching records found.</p>
      <p className="mt-1 text-sm text-slate-500">Try a different search, or clear it to see everything.</p>
    </div>
  );
}

/**
 * A table in a horizontally scrollable region (keyboard users can scroll it: it is focusable). On phones each row
 * becomes a small card (label above value) instead of scrolling sideways; the column labels come from the header.
 * Tables with buttons or links in the header (sorting) keep the scrolling layout. stack={false} opts out.
 */
export function Table({ children, label, stack = true }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const table = ref.current?.querySelector('table');
    if (!table) return undefined;
    const apply = () => {
      const heads = [...table.querySelectorAll('thead tr:last-child th')];
      // A select-all checkbox is fine (the page offers its own on phones); sort buttons or links keep the scrolling layout.
      const on = stack && heads.length > 0 && !table.querySelector('thead button, thead select, thead a, thead input:not([type="checkbox"])');
      table.classList.toggle('cs-stack', on);
      if (!on) return;
      // Keep table semantics for screen readers when rows are shown as cards.
      table.setAttribute('role', 'table');
      table.querySelectorAll('thead, tbody, tfoot').forEach((g) => g.setAttribute('role', 'rowgroup'));
      heads.forEach((th) => th.setAttribute('role', 'columnheader'));
      const labels = heads.map((th) => (th.querySelector('.sr-only') && th.textContent.trim() === th.querySelector('.sr-only').textContent.trim() ? '' : th.textContent.trim()));
      table.querySelectorAll('tr').forEach((tr) => {
        tr.setAttribute('role', 'row');
        if (tr.parentElement?.tagName === 'THEAD') return;
        let col = 0;
        [...tr.children].forEach((td) => {
          if (td.tagName === 'TD' || td.tagName === 'TH') {
            td.setAttribute('role', td.tagName === 'TH' ? 'rowheader' : 'cell');
            const l = td.colSpan > 1 ? '' : (labels[col] || '');
            if (td.dataset.label !== l) td.dataset.label = l;
            if (td.colSpan > 1) td.dataset.wide = '1'; else delete td.dataset.wide;
          }
          col += td.colSpan || 1;
        });
      });
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(table, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [stack]);
  return (
    <div ref={ref} className="relative overflow-x-auto focus-visible:ring-2 focus-visible:ring-brand" tabIndex={0} role="region" aria-label={label || 'Table'}>
      <table className="cs-table min-w-full divide-y divide-slate-100">{children}</table>
    </div>
  );
}
