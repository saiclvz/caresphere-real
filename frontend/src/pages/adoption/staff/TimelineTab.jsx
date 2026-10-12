import { useState } from 'react';
import { CalendarClock, FileText, Flag, GitCommitHorizontal } from 'lucide-react';
import { formatDateTime } from '../../../lib/format';
import { Button, Card, EmptyState } from '../../../components/ui';
import { TabState, useTab } from './common';

const ICON = { status: GitCommitHorizontal, request: FileText, interview: CalendarClock, milestone: Flag };
const PAGE = 15;

/** Timeline: status history and key events with friendly labels. Read-only (nothing can be edited or deleted). */
export default function TimelineTab({ app, version }) {
  const state = useTab(app.application_id, 'timeline', version);
  const [shown, setShown] = useState(PAGE);
  return (
    <TabState state={state} rows={8}>
      {(d) => (d.events.length === 0 ? <EmptyState title="Nothing recorded yet" /> : (
        <Card className="p-4">
          <ol className="relative space-y-3 border-l border-slate-200 pl-5">
            {d.events.slice(0, shown).map((e, i) => {
              const Icon = ICON[e.kind] || Flag;
              return (
                <li key={`${e.at}-${i}`} className="relative text-sm">
                  <span className="absolute -left-[1.85rem] top-0 flex h-5 w-5 items-center justify-center rounded-full bg-white ring-1 ring-slate-200"><Icon className="h-3 w-3 text-brand" aria-hidden /></span>
                  <p className="text-navy-900">{e.text}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(e.at)}{e.by ? ` · ${e.by}` : ''}{e.message ? ` · ${e.message}` : ''}</p>
                </li>
              );
            })}
          </ol>
          {d.events.length > shown && <Button size="sm" variant="secondary" className="mt-3" onClick={() => setShown((n) => n + PAGE)}>Show older ({d.events.length - shown})</Button>}
        </Card>
      ))}
    </TabState>
  );
}
