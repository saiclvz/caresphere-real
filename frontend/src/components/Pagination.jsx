import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZES = [10, 20, 50];

/**
 * Page state that resets to page 1 whenever `filterKey` changes (search, filters or page size),
 * without an extra request for the old page.
 */
export function usePageState(filterKey) {
  const [state, setState] = useState({ key: filterKey, page: 1 });
  const page = state.key === filterKey ? state.page : 1;
  const setPage = (p) => setState({ key: filterKey, page: p });
  return [page, setPage];
}

/** Page numbers with ellipses: 1 … 4 5 6 … 12 */
function pageList(current, total) {
  const pages = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(`gap-${p}`);
    out.push(p);
  });
  return out;
}

/**
 * Reusable pagination bar: "Showing 21-40 of 87", Previous, page numbers, Next, and a
 * page size selector (10, 20, 50). Works with the server's { page, limit, total, total_pages }.
 */
export default function Pagination({ pagination, onPageChange, onLimitChange, label = 'results', bordered = true }) {
  if (!pagination) return null;
  const { page, limit, total, total_pages: totalPages } = pagination;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const go = (p) => { if (p >= 1 && p <= totalPages && p !== page) onPageChange(p); };
  const btn = 'inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className={`flex flex-col gap-3 ${bordered ? 'border-t border-slate-100' : ''} px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between`}>
      <p className="text-slate-500" aria-live="polite">
        {total === 0 ? `No ${label}` : <>Showing <span className="font-medium text-navy-900">{from}-{to}</span> of <span className="font-medium text-navy-900">{total}</span> {label}</>}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-slate-500">
          Per page
          <select className="input h-9 w-20 py-1" value={limit} onChange={(e) => onLimitChange(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <button type="button" className={`${btn} text-slate-600 hover:bg-slate-100`} onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Previous</span>
          </button>
          {pageList(page, totalPages).map((p) => (typeof p === 'string'
            ? <span key={p} className="px-1 text-slate-400" aria-hidden>…</span>
            : (
              <button key={p} type="button" onClick={() => go(p)} aria-label={`Page ${p}`} aria-current={p === page ? 'page' : undefined}
                className={`${btn} ${p === page ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
            )))}
          <button type="button" className={`${btn} text-slate-600 hover:bg-slate-100`} onClick={() => go(page + 1)} disabled={page >= totalPages} aria-label="Next page">
            <span className="hidden sm:inline">Next</span> <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </nav>
      </div>
    </div>
  );
}
