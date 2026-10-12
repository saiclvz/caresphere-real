/**
 * Staff duties: the areas a Staff account may use (Admin chooses them under User accounts). The server
 * enforces them; the app uses this only to show the menu items and pages a person can use.
 */
export const DUTY_LABELS = {
  children: 'Child records', health: 'Health records', adoption: 'Adoption', transition: 'Transition Review',
  donations: 'Donations', donor_directory: 'Donor directory', visitors: 'Visitors', inventory: 'Inventory', meals: 'Meals',
};
export const hasDuty = (user, duty) => !user || user.role !== 'Staff' || (user.duties || []).includes(duty);

/** Which duty each Staff menu page needs. */
export const PAGE_DUTY = {
  '/children': 'children', '/adoptions': 'adoption', '/transitions': 'transition', '/inventory': 'inventory',
  '/donations': 'donations', '/donors': 'donor_directory', '/visitors': 'visitors', '/meals': 'meals',
};
