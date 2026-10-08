import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

/**
 * Whether this sign-in session accepted an area's confidentiality undertaking (adoption | transition).
 * Used outside the area to show a locked placeholder instead of the undertaking card. Returns
 * true / false, or null while checking. Donors: true (the server limits them to their own records).
 */
export default function useAreaAccepted(area) {
  const { user, acceptedAreas, markAreaAccepted } = useAuth();
  const staff = ['Admin', 'Staff'].includes(user?.role);
  const [state, setState] = useState(() => (!staff || acceptedAreas.has(area) ? true : null));
  useEffect(() => {
    if (!staff || acceptedAreas.has(area)) { setState(true); return; }
    api(`/compliance/undertaking?area=${area}`)
      .then((r) => { if (r.data.accepted) markAreaAccepted(area); setState(Boolean(r.data.accepted)); })
      .catch(() => setState(false));
  }, [area, staff, acceptedAreas, markAreaAccepted]);
  return state;
}
