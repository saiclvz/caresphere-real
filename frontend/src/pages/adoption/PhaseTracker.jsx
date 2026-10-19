import { Check } from 'lucide-react';
import { adoptionLabel } from '../../lib/adoptionStatus';

/**
 * 4-phase progress (Preparation, Matching, Petition, Finalization) with the current stage
 * and next step in plain language. Relative/Stepchild applications skip Matching.
 */
export default function PhaseTracker({ app }) {
  const { stage, phases, application_type: type } = app;
  const current = stage.phase_index;
  const ended = ['Declined', 'Withdrawn'].includes(app.status);
  const closed = app.status === 'Closed';
  return (
    <section className="cs-card p-4" aria-labelledby="tracker-title">
      <h2 id="tracker-title" className="cs-title mb-3">Progress</h2>
      {app.status !== 'Draft' && !ended && (
        <ol className="mb-4 grid grid-cols-4 gap-2" aria-label="Adoption phases">
          {phases.map((p, i) => {
            const skipped = type && type !== 'Regular' && p.key === 'matching';
            const done = closed || i < current || (skipped && current > i);
            const isCurrent = !closed && i === current;
            return (
              <li key={p.key} className="text-center" aria-current={isCurrent ? 'step' : undefined}>
                <span className={`cs-phase ${done ? 'is-done' : isCurrent ? 'is-current' : ''}`}>
                  {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                <span className={`mt-1 block text-xs ${isCurrent ? 'cs-title' : 'cs-muted'}`}>{p.label}</span>
                {skipped && <span className="cs-muted block text-[11px]">Not needed</span>}
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-sm"><span className="cs-muted">Current stage: </span><span className="cs-title">{adoptionLabel(app.status)}</span></p>
      <p className="mt-1 text-sm">{stage.description}</p>
      {stage.next_step && <p className="mt-2 text-sm"><span className="cs-muted">Next step: </span>{stage.next_step}</p>}
    </section>
  );
}
