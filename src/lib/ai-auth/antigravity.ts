import {
  AntigravityAccountStore,
  exchangeAntigravityCode,
  startAntigravityLogin,
  type AntigravityAccountStatus,
} from "@flyvendedk799/ai-auth";
import { AppError } from "@/lib/errors";
import { SupabaseCredentialStore } from "./store";

function sealingSecret(): string | null {
  return process.env.AI_AUTH_SECRET ?? process.env.SUPABASE_AUTH_JWT_SECRET ?? null;
}

let cached: AntigravityAccountStore | null | undefined;

export function antigravityAccounts(): AntigravityAccountStore | null {
  if (cached !== undefined) return cached;
  const secret = sealingSecret();
  cached = secret
    ? new AntigravityAccountStore({
        store: new SupabaseCredentialStore(),
        secret,
        namespace: "boared",
      })
    : null;
  return cached;
}

export function resetAntigravityAccounts() {
  cached = undefined;
}

const PENDING_TTL_MS = 10 * 60 * 1000;
const pending = new Map<string, { verifier: string; state: string; expiresAt: number }>();

function sweep(now: number) {
  for (const [id, entry] of pending) if (entry.expiresAt <= now) pending.delete(id);
}

export interface AntigravityConnection extends AntigravityAccountStatus {
  available: boolean;
}

const UNAVAILABLE: AntigravityConnection = {
  available: false,
  connected: false,
  email: null,
  expiresAt: null,
  expired: false,
  projectId: null,
};

export async function antigravityStatusFor(accountId: string): Promise<AntigravityConnection> {
  const accounts = antigravityAccounts();
  if (!accounts) return UNAVAILABLE;
  return { available: true, ...(await accounts.status(accountId)) };
}

export function beginAntigravityLogin(accountId: string): {
  url: string;
  expiresInSeconds: number;
} {
  if (!antigravityAccounts()) {
    throw new AppError(
      "antigravity_unavailable",
      "This deployment can't store an Antigravity connection.",
      {
        status: 501,
      },
    );
  }
  const now = Date.now();
  sweep(now);

  const start = startAntigravityLogin(false);
  pending.set(accountId, {
    verifier: start.verifier,
    state: start.state,
    expiresAt: now + PENDING_TTL_MS,
  });
  return { url: start.url, expiresInSeconds: Math.floor(PENDING_TTL_MS / 1000) };
}

export function parsePastedAntigravityCode(
  pasted: string,
): { code: string; state: string | null } | null {
  try {
    const raw = pasted.trim();
    if (!raw.includes("?") && !raw.includes("=")) {
      return { code: raw, state: null };
    }
    const url = new URL(raw.startsWith("http") ? raw : `http://localhost/?${raw}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) return null;
    return { code, state };
  } catch {
    return null;
  }
}

export async function completeAntigravityLogin(
  accountId: string,
  pasted: string,
): Promise<AntigravityConnection> {
  const accounts = antigravityAccounts();
  if (!accounts) {
    throw new AppError(
      "antigravity_unavailable",
      "This deployment can't store an Antigravity connection.",
      {
        status: 501,
      },
    );
  }

  const now = Date.now();
  sweep(now);
  const entry = pending.get(accountId);
  if (!entry) {
    throw new AppError("antigravity_login_expired", "That login has expired. Start it again.", {
      status: 400,
    });
  }

  const parsed = parsePastedAntigravityCode(pasted);
  if (!parsed) {
    throw new AppError(
      "antigravity_code_unreadable",
      "That didn't look like an authorization code.",
      {
        status: 400,
      },
    );
  }

  if (parsed.state !== null && entry.state !== parsed.state) {
    pending.delete(accountId);
    throw new AppError("antigravity_state_mismatch", "That code belongs to a different login.", {
      status: 400,
    });
  }

  try {
    const identity = await exchangeAntigravityCode({
      code: parsed.code,
      verifier: entry.verifier,
      isDogfood: false,
    });
    await accounts.save(accountId, identity);
  } catch (e) {
    pending.delete(accountId);
    throw new AppError("antigravity_exchange_failed", messageFor(e), { status: 400 });
  }

  pending.delete(accountId);
  return antigravityStatusFor(accountId);
}

export async function disconnectAntigravity(accountId: string): Promise<AntigravityConnection> {
  const accounts = antigravityAccounts();
  if (!accounts) return UNAVAILABLE;
  pending.delete(accountId);
  await accounts.forget(accountId);
  return antigravityStatusFor(accountId);
}

function messageFor(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.length > 0 ? raw : "The authorization code was refused. Start the login again.";
}
