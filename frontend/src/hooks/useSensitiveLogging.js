import { useEffect } from 'react';
import { api } from '../api/client';

/**
 * While a sensitive record is open, report copy and print actions the browser can detect to the
 * access log (server side). Nothing about the record's content is sent, only the event.
 */
export default function useSensitiveLogging(recordType, recordId, active, headers) {
  useEffect(() => {
    if (!active) return undefined;
    const send = (event) => api('/unlock/events', { method: 'POST', headers, body: { record_type: recordType, record_id: String(recordId), event } }).catch(() => {});
    const onCopy = () => send('copy');
    const onPrint = () => send('print');
    document.addEventListener('copy', onCopy);
    window.addEventListener('beforeprint', onPrint);
    return () => { document.removeEventListener('copy', onCopy); window.removeEventListener('beforeprint', onPrint); };
  }, [recordType, recordId, active]); // eslint-disable-line react-hooks/exhaustive-deps
}
