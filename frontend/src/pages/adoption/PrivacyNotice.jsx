import useApi from '../../hooks/useApi';

/** Privacy notice (RA 10173): purpose, who sees the data, retention, rights, DPO contact. */
export default function PrivacyNotice({ notice }) {
  const settings = useApi('/settings');
  const s = settings.data?.data || {};
  const dpo = [s.dpo_name, s.dpo_email, s.dpo_phone].filter(Boolean).join(' · ');
  return (
    <section className="cs-card p-4" aria-labelledby="privacy-title">
      <h3 id="privacy-title" className="cs-title">{notice.title}</h3>
      <dl className="mt-2 space-y-2 text-sm">
        {notice.sections.map((sec) => (
          <div key={sec.heading}><dt className="cs-title text-sm">{sec.heading}</dt><dd className="cs-muted">{sec.text}</dd></div>
        ))}
        <div><dt className="cs-title text-sm">Data Protection Officer</dt><dd className="cs-muted">{dpo || 'Ask the home for the Data Protection Officer\'s contact details.'}</dd></div>
      </dl>
      <p className="cs-hint mt-2">Notice version {notice.version}</p>
    </section>
  );
}
