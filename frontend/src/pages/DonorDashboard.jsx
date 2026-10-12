import { Link } from 'react-router-dom';
import { Baby, HandHeart, PackageOpen, Receipt } from 'lucide-react';
import useApi from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Card, EmptyState, ErrorNote, NoMatches, WelcomeBanner, Spinner, StatTile } from '../components/ui';
import { formatDate, formatMoney, matches } from '../lib/format';

function StockBar({ quantity, min }) {
  const pct = Math.min(100, Math.round((quantity / Math.max(min * 2, 1)) * 100));
  const tone = quantity === 0 ? 'bg-red-500' : quantity <= min ? 'bg-amber-500' : 'bg-brand';
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100" aria-hidden>
      <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${Math.max(pct, 3)}%` }} />
    </div>
  );
}

export default function DonorDashboard() {
  const { user } = useAuth();
  const { query } = useApp();
  const summary = useApi('/donor/summary');
  const stocks = useApi('/donor/needed-stocks');
  const needs = useApi('/donor/child-needs');

  const s = summary.data?.data;
  const stockList = (stocks.data?.data || []).filter((i) => matches(query, i.item_name, i.category));
  const needList = (needs.data?.data || []).filter((c) => matches(query, c.urgent_needs, c.display_name));

  return (
    <>
      <WelcomeBanner title={`Thank you, ${user.full_name.split(' ')[0]}`}
        description="These are the supplies and needs the home is short on right now. The list updates as staff record stock."
        actions={<Link to="/donations/history" className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-navy-900 transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"><Receipt className="h-4 w-4" aria-hidden /> My receipts</Link>} />

      {s && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile icon={HandHeart} label={`Given across ${s.donation_count} donation${Number(s.donation_count) === 1 ? '' : 's'}`} value={formatMoney(s.total_amount)} tone="green" />
          <StatTile icon={PackageOpen} label="Supplies needed now" value={s.needed_items} tone="amber" />
          <StatTile icon={Baby} label="Children in care" value={s.children_in_care} />
        </div>
      )}
      {s?.last_donation_at && <p className="mt-3 text-sm text-slate-500">Your last donation was recorded on {formatDate(s.last_donation_at)}.</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-navy-900">Needed supplies</h2>
            <p className="text-sm text-slate-500">Lowest stock first</p>
          </div>
          {stocks.loading && !stocks.data ? <Spinner /> : stocks.error ? <div className="p-5"><ErrorNote error={stocks.error} onRetry={stocks.reload} /></div> : stockList.length === 0 ? (
            query ? <NoMatches /> : <EmptyState icon={PackageOpen} title="Nothing urgent right now" description="Every tracked supply is above its minimum level." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {stockList.map((i) => (
                <li key={i.item_id} className="px-5 py-3.5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-navy-900">{i.item_name}</p>
                      <p className="text-xs text-slate-500">{i.category}</p>
                    </div>
                    {Number(i.quantity) === 0 ? <Badge tone="red">Out of stock</Badge> : i.is_low_stock ? <Badge tone="amber">Low: {i.quantity} left</Badge> : <Badge tone="blue">Requested</Badge>}
                  </div>
                  <StockBar quantity={Number(i.quantity)} min={Number(i.min_threshold)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-navy-900">Children's needs</h2>
            <p className="text-sm text-slate-500">Names are shortened to protect each child's privacy.</p>
          </div>
          {needs.loading && !needs.data ? <Spinner /> : needs.error ? <div className="p-5"><ErrorNote error={needs.error} onRetry={needs.reload} /></div> : needList.length === 0 ? (
            query ? <NoMatches /> : <EmptyState icon={Baby} title="No specific needs posted" description="General supply donations help every child in care." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {needList.map((c) => (
                <li key={c.child_id} className="px-5 py-3.5">
                  <p className="text-sm font-medium text-navy-900">{c.display_name} <span className="font-normal text-slate-500">· {c.age_label}</span></p>
                  <p className="mt-1 text-sm text-slate-600">{c.urgent_needs}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
