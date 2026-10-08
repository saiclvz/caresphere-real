/**
 * Official verification providers (item 7). None exists today that a private system can use: the NBI,
 * PNP and courts offer no API, and PhilSys identity checks need accreditation as a relying party. So both
 * are null, and every ID and clearance goes to a person for manual verification.
 *
 * When an authorized service becomes available, add it here; no other code changes are needed:
 *
 *   government_id: {
 *     name: 'PhilSys eVerify',                    // shown in the checks and the audit trail
 *     async verify({ type, number, holder, dob, expiry }) {
 *       // call the official API (keep its keys in backend/.env)
 *       return { result: 'verified' | 'not_found' | 'mismatch' | 'unavailable', reference: 'official ref', detail: 'short text' };
 *     },
 *   },
 *
 * Only a 'verified' result from a provider listed here can mark a record "Verified" automatically
 * ("Verified – real and valid"). Anything else, or an error, leaves it for a person.
 */
module.exports = {
  government_id: null,
  clearance: null,
  TIMEOUT_MS: 10000,
};
