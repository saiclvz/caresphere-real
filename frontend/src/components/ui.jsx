import { Children, cloneElement, isValidElement, useEffect, useId, useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Inbox, Loader2, SearchX, ShieldOff, X } from 'lucide-react';

/** Standard wording for shared states (kept in one place). */
export const MESSAGES = {
  loading: 'Loading information...',
  empty: 'No records found.',
  error: 'Something went wrong. Please try again.',
  denied: 'Access denied – You are not authorized to view this information.',
  invalid: 'Please correct the highlighted information.',
  saved: 'Your changes have been saved successfully.',
};

export function Button({ variant = 'primary', size = 'md', loading, className = '', children, ...props }) {
  const variants = {
    primary: 'bg-brand text-white shadow-sm hover:bg-brand-dark active:bg-brand-800 disabled:bg-brand/45 disabled:shadow-none',
    secondary: 'bg-white text-navy-900 border border-slate-300 hover:border-brand/50 hover:bg-brand-50 active:bg-brand-100 disabled:bg-white disabled:text-slate-400 disabled:border-slate-200',
    danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 disabled:bg-red-300',
    ghost: 'text-slate-600 hover:bg-brand-50 hover:text-navy-900 active:bg-brand-100 disabled:text-slate-300',
    dark: 'bg-navy-900 text-white hover:bg-navy-800 active:bg-navy-950',
  };
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' };
  return (
    <button
      type="button"
      disabled={loading || props.disabled}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-[2.25rem] items-center justify-center gap-2 rounded-lg font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 enabled:active:translate-y-px disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${size === 'sm' ? 'min-h-0' : ''} ${className}`}
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
  return <div className={`rounded-xl border border-slate-200/70 bg-white shadow-card ${hover} ${className}`} {...props}>{children}</div>;
}

/**
 * Dashboard welcome: greeting, a short description and the CareSphere tagline on a navy brand panel.
 * Used on the dashboards only (the tagline isn't repeated on every page).
 */
export function WelcomeBanner({ title, description, actions, tagline = 'Every child deserves a loving home.' }) {
  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-navy-900 to-navy-950 px-6 py-6 text-white shadow-card sm:px-8">
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-brand/30 blur-3xl" aria-hidden />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-display text-sm font-semibold text-brand-300">{tagline}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[1.65rem]">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-slate-200">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </section>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900 sm:text-[1.65rem]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
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
    <div className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${t.box} ${className}`} role={tone === 'error' ? 'alert' : 'status'}>
      <t.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${t.icon}`} aria-hidden />
      <div className="min-w-0 flex-1"><span className="sr-only">{t.label}: </span>{title && <p className="font-semibold">{title}</p>}{children}</div>
    </div>
  );
}

export function Badge({ tone = 'slate', children, className = '' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700',
    navy: 'bg-navy-900 text-white',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}>{children}</span>;
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
    <div className="flex animate-fade items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden />
      <div className="flex-1"><span className="sr-only">Error: </span>{message}</div>
      {onRetry && <button type="button" onClick={onRetry} className="shrink-0 rounded font-medium text-red-800 underline underline-offset-2 hover:text-red-950">Try again</button>}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title = MESSAGES.empty, description, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center" role="status">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50"><Icon className="h-7 w-7 text-brand-300" aria-hidden /></span>
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
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 transition-colors hover:bg-brand-50 hover:text-navy-900" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div ref={bodyRef} className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, title, message, confirmLabel = 'Delete', onConfirm, onClose, loading }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}

export function StatTile({ icon: Icon, label, value, tone = 'blue' }) {
  const tones = { blue: 'bg-brand-50 text-brand', amber: 'bg-amber-50 text-amber-700', green: 'bg-emerald-50 text-emerald-700', slate: 'bg-slate-100 text-navy-800' };
  return (
    <Card interactive className="flex items-center gap-4 p-5">
      <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-5 w-5" aria-hidden /></div>
      <div>
        <p className="text-2xl font-semibold tabular-nums text-navy-900">{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </Card>
  );
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

/** A table in a horizontally scrollable region (keyboard users can scroll it: it is focusable). */
export function Table({ children, label }) {
  return (
    <div className="relative overflow-x-auto focus-visible:ring-2 focus-visible:ring-brand" tabIndex={0} role="region" aria-label={label || 'Table'}>
      <table className="cs-table min-w-full divide-y divide-slate-100">{children}</table>
    </div>
  );
}
