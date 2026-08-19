export const STOCKIST_OWNER_EMAILS = new Set([
  'adhit24@gmail.com',
  'suwandi_gunawan@yahoo.com',
]);

export function resolveStockistRole(email: string | null | undefined, profileRole: string | null | undefined): string {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (STOCKIST_OWNER_EMAILS.has(normalizedEmail)) return 'owner';
  return typeof profileRole === 'string' ? profileRole.trim().toLowerCase() : '';
}
