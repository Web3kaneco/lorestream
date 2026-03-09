// ──────────────────────────────────────────────────────────────
// Admin Whitelist — Controls who gets full access vs demo tier
//
// Full-access emails can be added two ways:
//   1. Directly in the ADMIN_EMAILS array below
//   2. Via the NEXT_PUBLIC_ADMIN_EMAILS env var (comma-separated)
//      e.g. NEXT_PUBLIC_ADMIN_EMAILS=judge1@gmail.com,judge2@gmail.com
// ──────────────────────────────────────────────────────────────

const ADMIN_EMAILS: string[] = [
  // Add your email and judge emails here:
  // 'yourname@gmail.com',
  // 'judge@example.com',
];

function getAdminEmails(): string[] {
  const envEmails = process.env.NEXT_PUBLIC_ADMIN_EMAILS || '';
  const extras = envEmails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return [...ADMIN_EMAILS.map(e => e.toLowerCase()), ...extras];
}

export function isAdminUser(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}
