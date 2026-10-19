/**
 * Display label for an adoption application status. The stored status stays 'Declined' (migration 009 mapped the
 * old 'Rejected' to it, and the server lock uses it); it is shown to everyone as "Rejected".
 */
const LABELS = { Declined: 'Rejected' };
export const adoptionLabel = (status) => LABELS[status] || status;
