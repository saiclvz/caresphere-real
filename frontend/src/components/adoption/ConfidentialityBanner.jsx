import { ShieldAlert } from 'lucide-react';

/** Confidentiality banner shown on every staff adoption page (RA 11642 Section 39). */
export default function ConfidentialityBanner() {
  return (
    <div className="mb-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="note">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <p><strong>Confidential adoption record.</strong> Under RA 11642 Section 39, open, copy or share this only as your work on the case requires. Every view is recorded.</p>
    </div>
  );
}
