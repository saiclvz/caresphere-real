import DueSoon from '../components/adoption/DueSoon';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Baby, Boxes, HandCoins, UserCheck, UtensilsCrossed } from 'lucide-react';
import useApi from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Badge, Card, ErrorNote, PageHeader, Spinner, StatTile } from '../components/ui';
import { formatMoney } from '../lib/format';

const monthLabel = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'short' });

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi('/dashboard/summary');

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  const d = data.data;
  const s = d.stats;

  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user.full_name.split(' ')[0]}`}
        description="Today at the home: who's in care, what's running low, and who's on site." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={Baby} label="Children in care" value={s.active_children} />
        <StatTile icon={Boxes} label="Items low on stock" value={s.low_stock} tone={s.low_stock ? 'amber' : 'green'} />
        <StatTile icon={UserCheck} label={`Visitors on site (${s.visitors_today} today)`} value={s.visitors_on_site} tone="slate" />
        <Card className="flex items-center gap-4 p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><HandCoins className="h-5 w-5" aria-hidden /></div>
          <div className="min-w-0">
            <p className="text-2xl font-semibold tabular-nums text-navy-900">{formatMoney(d.donations.received_total)}</p>
            <p className="text-sm text-slate-500">Received from {d.donations.count} donation{d.donations.count === 1 ? '' : 's'}</p>
            <Link to="/donations" className="text-sm font-medium text-brand hover:underline">View donations</Link>
          </div>
        </Card>
      </div>

      <div className="mt-6"><DueSoon /></div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <h2 className="font-semibold text-navy-900">Donations received, last 6 months</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.donation_trend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} width={70}
                  tickFormatter={(v) => (v >= 1000 ? `₱${(v / 1000).toFixed(0)}k` : `₱${v}`)} />
                <Tooltip formatter={(v) => formatMoney(v)} labelFormatter={monthLabel} cursor={{ fill: '#F1F5F9' }} />
                <Bar dataKey="total" name="Amount" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-navy-900">Running low</h2>
            <Link to="/inventory" className="text-sm font-medium text-brand hover:underline">Inventory</Link>
          </div>
          {d.low_items.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">Every item is above its minimum level.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {d.low_items.map((i) => (
                <li key={i.item_id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-navy-900">
                      {i.item_name}
                    </p>
                    <p className="text-xs text-slate-500">{i.category}</p>
                  </div>
                  <Badge tone={i.quantity === 0 ? 'red' : 'amber'}>{i.quantity} / {i.min_threshold}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 xl:col-span-2">
          <h2 className="font-semibold text-navy-900">Children in care by age</h2>
          {d.age_groups.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">No active children registered yet.</p>
          ) : (
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.age_groups}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="age_group" tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip cursor={{ fill: '#F1F5F9' }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="female" name="Girls" stackId="a" fill="#1E293B" />
                  <Bar dataKey="male" name="Boys" stackId="a" fill="#2563EB" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-navy-900">Today's meals</h2>
            <Link to="/meals" className="text-sm font-medium text-brand hover:underline">Meal plan</Link>
          </div>
          {d.meals_today.length === 0 ? (
            <div className="mt-6 flex items-start gap-2 text-sm text-slate-500">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" aria-hidden />
              No meals planned for today. <Link to="/meals" className="font-medium text-brand hover:underline">Add them</Link>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {d.meals_today.map((m, idx) => (
                <li key={idx} className="flex gap-3">
                  <UtensilsCrossed className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-navy-900">{m.meal_type}</p>
                    <p className="text-sm text-slate-500">{m.menu_description}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
