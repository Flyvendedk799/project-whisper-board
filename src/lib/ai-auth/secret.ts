/**
 * The key stored credentials are sealed with.
 *
 * A dedicated secret is preferred. The platform already injects the stack's JWT secret and that works,
 * but rotating it makes every stored credential unreadable and everyone has to reconnect. That is a
 * recoverable state (a status reports "disconnected"), not a broken one.
 *
 * One definition, because the Claude, Antigravity and GitHub connections must all agree on it.
 */
export function sealingSecret(): string | null {
  return process.env.AI_AUTH_SECRET ?? process.env.SUPABASE_AUTH_JWT_SECRET ?? null;
}
