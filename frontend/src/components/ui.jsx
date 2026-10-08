import { useEffect, useRef } from 'react';
import { AlertCircle, Loader2, SearchX, X } from 'lucide-react';

export function Button({ variant = 'primary', size = 'md', loading, className = '', children, ...props }) {
  const variants = {
    primary: 'bg-brand text-white hover:bg-brand-dark disabled:bg-brand/50',
    secondary: 'bg-white text-navy-900 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-navy-900',
    dark: 'bg-navy-900 text-white hover:bg-navy-800',
  };
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' };
  return (
    <button
      type="button"
      disabled={loading || props.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className = '', children, ...props }) {
  return <div className={`rounded-xl bg-white shadow-card ${className}`} {...props}>{children}</div>;
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, error, required = false, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-navy-800">
        {label}{required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
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

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex-1">{error.message || String(error)}</div>
      {onRetry && <button type="button" onClick={onRetry} className="font-medium underline">Try again</button>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Icon && <Icon className="mb-3 h-8 w-8 text-slate-300" aria-hidden />}
      <p className="font-medium text-navy-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useRef(null);
  const bodyRef = useRef(null);
  // Keep the latest onClose without re-running effects. Parents pass a new
  // arrow function on every render, so depending on it re-focused the modal
  // after every keystroke.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onCloseRef.current?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus the first form field once, when the modal opens (not the close button).
  useEffect(() => {
    if (!open) return;
    const field = bodyRef.current?.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    (field || ref.current?.querySelector('button'))?.focus();
  }, [open]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-6xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-900/60 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={`flex max-h-[92vh] w-full ${widths[size]} flex-col rounded-t-2xl bg-white shadow-modal sm:rounded-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-navy-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-navy-900" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div ref={bodyRef} className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
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
  const tones = { blue: 'bg-blue-50 text-brand', amber: 'bg-amber-50 text-amber-700', green: 'bg-emerald-50 text-emerald-700', slate: 'bg-slate-100 text-navy-800' };
  return (
    <Card className="flex items-center gap-4 p-5">
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

export function Table({ children }) {
  return <div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">{children}</table></div>;
}
