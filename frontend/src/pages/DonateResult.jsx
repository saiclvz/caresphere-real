import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { api } from '../api/client';
import { Button, Card, ErrorNote, Spinner } from '../components/ui';
import { formatMoney } from '../lib/format';

/**
 * /donate/result?payment=&r=success|cancel - where PayMongo sends the donor back. Display only: the
 * donation is created from PayMongo's webhook. While that hasn't arrived yet, this page checks again
 * a few times.
 */
export default function DonateResult() {
  const [params] = useSearchParams();
  const id = params.get('payment');
  const returned = params.get('r');
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!/^\d+$/.test(id || '')) { setError(new Error('This page needs a payment reference.')); return undefined; }
    let tries = 0;
    let timer;
    const load = () => api(`/donor/payments/${id}?r=${returned === 'cancel' ? 'cancel' : 'success'}`).then((r) => {
      setPayment(r.data);
      tries += 1;
      if (r.data.status === 'pending' && tries < 10) timer = setTimeout(load, 3000);
    }).catch(setError);
    load();
    return () => clearTimeout(timer);
  }, [id, returned]);

  if (error) return <div className="mx-auto max-w-xl"><ErrorNote error={error} /></div>;
  if (!payment) return <Spinner label="Checking your payment" />;
  const s = payment.status;
  const view = s === 'paid'
    ? { icon: CheckCircle2, tone: 'text-emerald-600', title: 'Thank you! Your donation was received.', body: 'Your receipt is ready in Donation history.' }
    : s === 'pending'
      ? { icon: Clock, tone: 'text-amber-600', title: 'Waiting for the payment confirmation', body: "If you completed the payment, it will appear in Donation history in a moment. You'll also get a notification." }
      : s === 'cancelled'
        ? { icon: XCircle, tone: 'text-slate-500', title: 'Payment cancelled', body: 'No money was taken and no donation was recorded. You can try again any time.' }
        : { icon: XCircle, tone: 'text-red-600', title: s === 'expired' ? 'Checkout expired' : 'Payment failed', body: 'No donation was recorded. You can try again, or choose another method.' };
  const Icon = view.icon;
  return (
    <div className="mx-auto max-w-xl">
      <Card className="p-6 text-center">
        <Icon className={`mx-auto h-12 w-12 ${view.tone}`} aria-hidden />
        <h1 className="mt-3 text-xl font-semibold text-navy-900">{view.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{formatMoney(payment.amount)} by {payment.method_name} · {payment.status_label}</p>
        <p className="mt-3 text-sm text-slate-600">{view.body}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link to="/donations/history"><Button variant="secondary">Donation history</Button></Link>
          {!['paid', 'pending'].includes(s) && <Link to="/donate"><Button>Try again</Button></Link>}
        </div>
      </Card>
    </div>
  );
}
