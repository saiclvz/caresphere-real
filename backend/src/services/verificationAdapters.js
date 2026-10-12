/**
 * Official verification adapters for government IDs (one per ID type, chosen in tbl_id_type_rules.adapter).
 *
 * Interface: run(query) with query = { type, number, holder, dob, expiry, scan } returns
 *   { status: 'verified' | 'not_verified' | 'unable' | 'failed' | 'staff_step' | 'none',
 *     source, reference, timestamp, raw, detail, mode: 'automatic' | 'staff_confirmed' | null }
 *
 * Only 'verified' from an AUTHORIZED source counts as "Verified – real and valid". Adapter failures or no
 * internet give 'unable' or 'failed', never 'verified'. Only call services the home is authorized to use.
 *
 * Today:
 *  - philsys_check: the PSA publishes no server API for private systems (PhilSys Check is a web page at
 *    verify.philsys.gov.ph). So this adapter returns 'staff_step': an authorized staff member scans the
 *    original QR with PhilSys Check and records the result in CareSphere ("Staff-confirmed").
 *  - mrz_consistency: passport MRZ check digits. Consistency only, not authenticity: always 'none'.
 *  - manual: no official source for this ID type; manual verification required.
 *  - Any key that matches an automatic provider in config/verificationProviders.js (for example a future
 *    authorized API) is called with a timeout.
 */
const Providers = require('../config/verificationProviders');

const ADAPTERS = {
  philsys_check: {
    label: 'PhilSys Check (verify.philsys.gov.ph)',
    async run() {
      return { status: 'staff_step', source: 'PhilSys Check', mode: null, detail: 'No server API is published by the PSA. An authorized staff member checks the QR with PhilSys Check and records the result.' };
    },
  },
  mrz_consistency: {
    label: 'Passport MRZ check digits (consistency only)',
    async run() { return { status: 'none', source: null, mode: null, detail: 'MRZ check digits show the data is consistent, not that the passport is genuine. No official DFA verification service is connected.' }; },
  },
  manual: {
    label: 'Manual verification (no official source)',
    async run() { return { status: 'none', source: null, mode: null, detail: 'No official verification service is connected for this ID type.' }; },
  },
};

/** Runs the adapter for a rule. Never throws; never returns 'verified' without an authorized automatic source. */
async function run(adapterKey, query) {
  const provider = Providers[adapterKey] || (adapterKey === 'government_id' ? Providers.government_id : null);
  if (provider && typeof provider.verify === 'function') {
    const at = new Date();
    try {
      const r = await Promise.race([provider.verify(query), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), Providers.TIMEOUT_MS))]);
      const map = { verified: 'verified', not_found: 'not_verified', mismatch: 'not_verified', unavailable: 'unable' };
      return { status: map[r?.result] || 'failed', source: provider.name, reference: r?.reference || null, timestamp: at, raw: r, detail: r?.detail || null, mode: 'automatic' };
    } catch (err) {
      return { status: 'unable', source: provider.name, reference: null, timestamp: at, raw: { error: err.message }, detail: `${provider.name} could not be reached.`, mode: 'automatic' };
    }
  }
  const a = ADAPTERS[adapterKey] || ADAPTERS.manual;
  return { reference: null, timestamp: null, raw: null, ...(await a.run(query)) };
}

const labelOf = (key) => ADAPTERS[key]?.label || Providers[key]?.name || key;
// Adapters to choose from in Settings > ID types: the built-in ones plus any authorized provider configured
// in config/verificationProviders.js (the place to plug in an official verification later).
const KEYS = [...Object.keys(ADAPTERS), ...Object.keys(Providers).filter((k) => typeof Providers[k]?.verify === 'function')];

module.exports = { run, labelOf, KEYS };
