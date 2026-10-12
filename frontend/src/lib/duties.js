/**
 * Staff duties: the areas a Staff account may use (Admin chooses them under User accounts). The server
 * enforces them; the app uses this only to show the menu items and pages a person can use.
 */
export const DUTY_LABELS = {
  children: 'Child records', admission: 'Admission', health: 'Health records', adoption: 'Adoption', transition: 'Transition Review',
  donations: 'Donations', donor_directory: 'Donor directory', visitors: 'Visitors', inventory: 'Inventory', meals: 'Meals',
};
/** duty can be one key or a list (any of them). */
export const hasDuty = (user, duty) => !user || user.role !== 'Staff' || (Array.isArray(duty) ? duty : [duty]).some((d) => (user.duties || []).includes(d));

/** Which duty each Staff menu page needs. */
export const PAGE_DUTY = {
  '/children': ['children', 'admission'], '/adoptions': 'adoption', '/transitions': 'transition', '/inventory': 'inventory',
  '/donations': 'donations', '/donors': 'donor_directory', '/visitors': 'visitors', '/meals': 'meals',
};
