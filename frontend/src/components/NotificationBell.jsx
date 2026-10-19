import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, MoreHorizontal } from 'lucide-react';
import { api, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { badgeText, iconFor, isToday, relativeTime } from '../lib/notifications';
import { Spinner } from './ui';

/**
 * The bell (Admin, Staff, Donor): unread badge, the 10 latest grouped as Today and Earlier, filter
 * chips for the user's categories with unread counts, Mark all as read for what the chip shows, and
 * View all. Opening an item asks the server first, so a removed record or lost access shows a message.
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const { notifCounts, refreshRequests, toast } = useApp();
  const unread = notifCounts.all || 0;
  const [open, setOpen] = useState(false);
  const [chip, setChip] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const box = useRef(null);
  const button = useRef(null);
  const panel = useRef(null);

  const filterFor = (c) => (c === 'all' ? {} : c === 'unread' ? { status: 'unread' } : { category: c });
  const load = useCallback(async (c = chip) => {
    try { const res = await api(`/notifications${qs({ page: 1, limit: 10, ...filterFor(c) })}`); setData(res); setError(null); } catch (err) { setError(err); }
  }, [chip]);
  useEffect(() => { if (open) load(); }, [open, chip, load]);
  useEffect(() => { if (open) refreshRequests?.(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    panel.current?.focus();
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const openItem = async (n) => {
    try {
      const res = await api(`/notifications/${n.notification_id}/open`, { method: 'POST' });
      setOpen(false); refreshRequests?.();
      if (res.data.link) navigate(res.data.link); else toast(res.data.message);
    } catch (err) { toast(err.message, 'error'); }
  };
  const rows = data?.data || [];
  const shownUnread = rows.filter((r) => !r.is_read).length;
  const markShown = async () => {
    setConfirm(false);
    await api('/notifications/read-all', { method: 'POST', body: { filters: filterFor(chip) } }).catch((e) => toast(e.message, 'error'));
    refreshRequests?.(); load();
  };
  const markAll = async () => {
    setMenu(false);
    await api('/notifications/read-all', { method: 'POST', body: {} }).catch((e) => toast(e.message, 'error'));
    refreshRequests?.(); load();
  };
  const chips = [{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }, ...(data?.categories || [])];
  const countFor = (k) => (k === 'unread' ? notifCounts.all : k === 'all' ? 0 : notifCounts[k] || 0);
  const today = rows.filter((r) => isToday(r.created_at));
  const earlier = rows.filter((r) => !isToday(r.created_at));
  const empty = chip === 'unread' ? 'No unread notifications' : 'Nothing here yet';

  const Item = ({ n }) => {
    const Icon = iconFor(n);
    return (
      <li>
        <button type="button" onClick={() => openItem(n)} className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none ${n.is_read ? '' : 'bg-blue-50/60'}`}>
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${n.priority === 'action' ? 'text-red-600' : n.priority === 'warning' ? 'text-amber-600' : 'text-slate-500'}`} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className={`block break-words text-sm [overflow-wrap:anywhere] ${n.is_read ? 'text-slate-700' : 'font-semibold text-navy-900'}`}>{n.title}</span>
            <span className="line-clamp-2 block break-words text-xs text-slate-500 [overflow-wrap:anywhere]">{n.body}</span>
            <span className="block text-xs text-slate-500">{relativeTime(n.created_at)}{n.is_read ? '' : ' · unread'}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="relative" ref={box}>
      <button ref={button} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[1.25rem] rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-5 text-white">{badgeText(unread)}</span>}
      </button>
      <span className="sr-only" aria-live="polite">{unread ? `${unread} unread notifications` : ''}</span>
      {open && (
        <div ref={panel} tabIndex={-1} role="dialog" aria-label="Notifications"
          className="fixed inset-x-2 top-16 z-50 max-h-[80vh] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-modal focus:outline-none sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-navy-900">Notifications</h2>
            <div className="relative flex items-center gap-1">
              <button type="button" disabled={!shownUnread} onClick={() => (chip === 'all' ? markShown() : setConfirm(true))}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand hover:bg-slate-100 disabled:opacity-40">
                <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Mark all as read
              </button>
              <button type="button" onClick={() => setMenu((m) => !m)} aria-label="More actions" aria-expanded={menu} className="rounded-md p-1 text-slate-500 hover:bg-slate-100"><MoreHorizontal className="h-4 w-4" /></button>
              {menu && (
                <div className="absolute right-0 top-8 z-10 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-modal">
                  <button type="button" onClick={markAll} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">Mark everything as read</button>
                  <Link to="/notifications/settings" onClick={() => setOpen(false)} className="block px-3 py-2 text-sm hover:bg-slate-50">Notification settings</Link>
                </div>
              )}
            </div>
          </div>
          {confirm && (
            <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900" role="alertdialog" aria-label="Confirm">
              <span className="flex-1">Mark the {shownUnread} shown as read?</span>
              <button type="button" className="font-semibold hover:underline" onClick={markShown}>Yes</button>
              <button type="button" className="hover:underline" onClick={() => setConfirm(false)}>No</button>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-3 py-2" role="tablist" aria-label="Filter notifications">
            {chips.map((c) => (
              <button key={c.key} type="button" role="tab" aria-selected={chip === c.key} onClick={() => { setChip(c.key); setConfirm(false); }}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${chip === c.key ? 'bg-brand text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:text-navy-900'}`}>
                {c.label}
                {countFor(c.key) > 0 && <span className={`rounded-full px-1.5 text-[10px] ${chip === c.key ? 'bg-white/20' : 'bg-red-600 text-white'}`}>{badgeText(countFor(c.key))}</span>}
              </button>
            ))}
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {error ? <p className="p-4 text-sm text-red-600">{error.message}</p> : !data ? <div className="p-4"><Spinner /></div> : rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-500">{empty}</p>
            ) : (
              <>
                {today.length > 0 && <><p className="bg-slate-50 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Today</p><ul className="divide-y divide-slate-100">{today.map((n) => <Item key={n.notification_id} n={n} />)}</ul></>}
                {earlier.length > 0 && <><p className="bg-slate-50 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Earlier</p><ul className="divide-y divide-slate-100">{earlier.map((n) => <Item key={n.notification_id} n={n} />)}</ul></>}
              </>
            )}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-brand hover:bg-slate-50">View all</Link>
        </div>
      )}
    </div>
  );
}
