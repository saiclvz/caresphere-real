import { useEffect, useId, useRef, useState } from 'react';
import { Accessibility, Check } from 'lucide-react';
import { TEXT_SIZES, useDisplayPrefs } from '../lib/displayPrefs';

function Toggle({ label, hint, checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-brand-50">
      <span><span className="block text-sm font-medium text-navy-900">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>
      <span aria-hidden className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-brand' : 'bg-slate-300'}`}>
        <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

/**
 * Display settings button and panel (header and sign-in pages): text size, reduce motion, higher
 * contrast. Esc or a click outside closes it; focus returns to the button.
 */
export default function DisplaySettings({ tone = 'light' }) {
  const { prefs, update, reset } = useDisplayPrefs();
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const panel = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const onDown = (e) => { if (!panel.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    panel.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const btnTone = tone === 'dark' ? 'text-white/80 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-navy-900';
  return (
    <div className="relative">
      <button ref={btn} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-lg p-2 text-sm transition-colors ${btnTone}`} title="Display settings">
        <Accessibility className="h-5 w-5" aria-hidden />
        <span className="sr-only">Display settings</span>
      </button>
      {open && (
        <div ref={panel} id={id} role="dialog" aria-label="Display settings"
          className="absolute right-0 z-50 mt-2 w-72 animate-slide-down rounded-xl border border-slate-200 bg-white p-3 text-left shadow-modal">
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Display settings</p>
          <fieldset className="px-2 py-1">
            <legend className="mb-1.5 text-sm font-medium text-navy-900">Text size</legend>
            <div className="grid grid-cols-3 gap-1">
              {TEXT_SIZES.map((s) => (
                <button key={s.value} type="button" aria-pressed={prefs.textSize === s.value} onClick={() => update({ textSize: s.value })}
                  className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${prefs.textSize === s.value ? 'border-brand bg-brand text-white' : 'border-slate-300 text-slate-700 hover:border-brand hover:bg-brand-50'}`}>
                  {prefs.textSize === s.value && <Check className="h-3 w-3" aria-hidden />}{s.label}
                </button>
              ))}
            </div>
          </fieldset>
          <Toggle label="Reduce motion" hint="Turns off animations and transitions." checked={prefs.reduceMotion} onChange={(v) => update({ reduceMotion: v })} />
          <Toggle label="Higher contrast" hint="Darker text and borders, underlined links." checked={prefs.contrast} onChange={(v) => update({ contrast: v })} />
          <div className="mt-1 flex items-center justify-between border-t border-slate-100 px-2 pt-2">
            <p className="text-[11px] text-slate-500">Saved on this browser only.</p>
            <button type="button" className="rounded px-1.5 py-0.5 text-xs font-medium text-brand hover:bg-brand-50" onClick={reset}>Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}
