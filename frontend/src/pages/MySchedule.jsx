import { CalendarClock } from 'lucide-react';
import useApi from '../hooks/useApi';
import { Card, EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { addDays, formatTime, isoDate } from '../lib/format';

export default function MySchedule() {
  const from = isoDate();
  const to = isoDate(addDays(new Date(), 27));
  const { data, loading, error, reload } = useApi(`/schedules/mine?from=${from}&to=${to}`);
  const shifts = data?.data || [];
  const grouped = shifts.reduce((acc, s) => { (acc[s.shift_date] ||= []).push(s); return acc; }, {});

  return (
    <>
      <PageHeader title="My schedule" description="Your shifts for the next four weeks." />
      {error && <ErrorNote error={error} onRetry={reload} />}
      <Card>
        {loading && !data ? <Spinner /> : shifts.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No upcoming shifts" description="Your administrator hasn't assigned any shifts in the next four weeks." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {Object.entries(grouped).map(([date, list]) => {
              const d = new Date(`${date}T00:00:00`);
              const isToday = date === from;
              return (
                <li key={date} className="flex gap-5 px-5 py-4">
                  <div className={`w-14 shrink-0 rounded-lg py-2 text-center ${isToday ? 'bg-brand text-white' : 'bg-page text-navy-900'}`}>
                    <p className="text-xs">{d.toLocaleDateString('en-PH', { weekday: 'short' })}</p>
                    <p className="text-lg font-semibold leading-tight">{d.getDate()}</p>
                  </div>
                  <div className="flex-1 space-y-2">
                    {list.map((s) => (
                      <div key={s.schedule_id}>
                        <p className="text-sm font-medium text-navy-900">{formatTime(s.start_time)} – {formatTime(s.end_time)}</p>
                        <p className="text-sm text-slate-500">{s.assignment}</p>
                      </div>
                    ))}
                  </div>
                  {isToday && <span className="self-start rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">Today</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
