import {
  ClaudeAccountStore,
  exchangeClaudeCode,
  parsePastedCode,
  sameState,
  startClaudeLogin,
  type ClaudeAccountStatus,
} from "@flyvendedk799/ai-auth";
import { AppError } from "@/lib/errors";
import { SupabaseCredentialStore } from "./store";

/**
 * A person's own Claude subscription, signed in to from this app.
 *
 * Who may connect one: anyone signed in, not just an administrator. That is the
 * point of the per-account flow — which provider the deployment uses is an
 * operator decision, but *whose plan pays* is the user's own, and a credential
 * only an admin could install would be neither.
 *
 * SERVER ONLY: this reaches for `node:crypto` through the account store.
 */

/**
 * The key the stored credential is sealed with.
 *
 * A dedicated secret is preferred. The platform already injects the stack's JWT
 * secret and that works, but it is worth knowing the consequence: rotating it
 * makes every stored credential unreadable, and everyone has to reconnect. That
 * is a recoverable state — `status` simply reports disconnected — not a broken
 * one.
 */
function sealingSecret(): string | null {
  return process.env.AI_AUTH_SECRET ?? process.env.SUPABASE_AUTH_JWT_SECRET ?? null;
}

let cached: ClaudeAccountStore | null | undefined;

/** Null when this deployment has nowhere to keep a credential. */
export function claudeAccounts(): ClaudeAccountStore | null {
  if (cached !== undefined) return cached;
  const secret = sealingSecret();
  cached = secret
    ? new ClaudeAccountStore({
        store: new SupabaseCredentialStore(),
        secret,
        namespace: "boared",
      })
    : null;
  return cached;
}

/** Test seam, and the reset after the secret changes under a running process. */
export function resetClaudeAccounts() {
  cached = undefined;
}

/**
 * The half-finished login, held in memory and keyed by account.
 *
 * Deliberately not in the database: the PKCE verifier is worthless after the
 * exchange and dangerous before it, so the shortest life is the right one. A
 * restart mid-login costs one click; persisting it would put the single secret
 * that makes a stolen authorization code useful into permanent storage.
 */
const PENDING_TTL_MS = 10 * 60 * 1000;
const pending = new Map<string, { verifier: string; state: string; expiresAt: number }>();

function sweep(now: number) {
  for (const [id, entry] of pending) if (entry.expiresAt <= now) pending.delete(id);
}

export interface ClaudeConnection extends ClaudeAccountStatus {
  /** False when the server has nowhere to keep a credential. */
  available: boolean;
}

const UNAVAILABLE: ClaudeConnection = {
  available: false,
  connected: false,
  plan: null,
  expiresAt: null,
  expired: false,
  scopes: [],
};

export async function claudeStatusFor(accountId: string): Promise<ClaudeConnection> {
  const accounts = claudeAccounts();
  if (!accounts) return UNAVAILABLE;
  return { available: true, ...(await accounts.status(accountId)) };
}

export function beginClaudeLogin(accountId: string): { url: string; expiresInSeconds: number } {
  if (!claudeAccounts()) {
    throw new AppError("claude_unavailable", "This deployment can't store a Claude connection.", {
      status: 501,
    });
  }
  const now = Date.now();
  sweep(now);

  const start = startClaudeLogin();
  pending.set(accountId, {
    verifier: start.verifier,
    state: start.state,
    expiresAt: now + PENDING_TTL_MS,
  });
  return { url: start.url, expiresInSeconds: Math.floor(PENDING_TTL_MS / 1000) };
}

export async function completeClaudeLogin(
  accountId: string,
  pasted: string,
): Promise<ClaudeConnection> {
  const accounts = claudeAccounts();
  if (!accounts) {
    throw new AppError("claude_unavailable", "This deployment can't store a Claude connection.", {
      status: 501,
    });
  }

  const now = Date.now();
  sweep(now);
  const entry = pending.get(accountId);
  if (!entry) {
    throw new AppError("claude_login_expired", "That login has expired. Start it again.", {
      status: 400,
    });
  }

  const parsed = parsePastedCode(pasted);
  if (!parsed) {
    throw new AppError("claude_code_unreadable", "That didn't look like an authorization code.", {
      status: 400,
    });
  }

  // `state` is what stops a code from someone else's login being pasted into
  // this one, so a mismatch is a refusal, not a retry.
  if (parsed.state !== null && !sameState(entry.state, parsed.state)) {
    pending.delete(accountId);
    throw new AppError("claude_state_mismatch", "That code belongs to a different login.", {
      status: 400,
    });
  }

  try {
    const identity = await exchangeClaudeCode({
      code: parsed.code,
      state: parsed.state ?? entry.state,
      verifier: entry.verifier,
    });
    await accounts.save(accountId, identity);
  } catch (e) {
    // A code can only be exchanged once, so a failure here is terminal for this
    // attempt whatever caused it — drop the pending login rather than invite a
    // retry that cannot work.
    pending.delete(accountId);
    throw new AppError("claude_exchange_failed", messageFor(e), { status: 400 });
  }

  pending.delete(accountId);
  return claudeStatusFor(accountId);
}

export async function disconnectClaude(accountId: string): Promise<ClaudeConnection> {
  const accounts = claudeAccounts();
  if (!accounts) return UNAVAILABLE;
  pending.delete(accountId);
  await accounts.forget(accountId);
  return claudeStatusFor(accountId);
}

function messageFor(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.length > 0 ? raw : "The authorization code was refused. Start the login again.";
}
