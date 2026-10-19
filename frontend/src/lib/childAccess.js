import { Eye, Lock, LockOpen, ShieldCheck, Clock } from 'lucide-react';

/**
 * Child record access levels: how the app shows what the server decided (services/childAccess.js on the server
 * decides; these only label it). The server never sends a locked field, so the page only shows placeholders.
 */
export const ACCESS_CHIP = {
  full: { label: 'Full', tone: 'green', Icon: ShieldCheck },
  unlock: { label: 'Unlock needed', tone: 'blue', Icon: LockOpen, hint: 'Core record open; health, adoption and transition need the unlock step' },
  temporary: { label: 'Temporary access', tone: 'amber', Icon: Clock, hint: 'As the registering staff member' },
  directory: { label: 'Directory only', tone: 'slate', Icon: Eye },
};
export const chipOf = (access) => ACCESS_CHIP[access?.chip] || { label: 'No access', tone: 'slate', Icon: Lock };

export const YOUR_ACCESS = { full: 'Full', unlock: 'Core', temporary: 'Core (temporary)', directory: 'Directory' };

export const ASSIGNMENT_TYPES = { primary: 'Primary case worker', backup: 'Backup', temporary: 'Temporary cover' };
export const CORE_LOCKED = 'Core record: Locked. Ask the assigned case worker or an Admin.';
export const DENIED = 'ACCESS DENIED – You are not authorized to view this information.';
