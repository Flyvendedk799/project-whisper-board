import { createHash, timingSafeEqual } from "node:crypto";
import { getMcpOAuthConfig, type McpOAuthConfig } from "./config";
import { getClient } from "./store";

export type RegisteredClient = NonNullable<Awaited<ReturnType<typeof getClient>>>;

/** Exact string match against the client's registered redirect_uris. */
export function exactRedirectMatch(client: RegisteredClient, redirectUri: string): boolean {
  return client.redirect_uris.includes(redirectUri);
}

export function parseBasicAuth(header: string | null): { clientId: string; secret: string } | null {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return { clientId: decoded.slice(0, idx), secret: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

function secretsEqual(provided: string, hash: string): boolean {
  const providedHash = createHash("sha256").update(provided).digest("hex");
  if (providedHash.length !== hash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(providedHash, "utf8"), Buffer.from(hash, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Authenticate a token/revoke request's client.
 * Supports public (none) and confidential (basic / post).
 */
export async function authenticateClient(input: {
  authHeader: string | null;
  bodyClientId: string | null;
  bodyClientSecret: string | null;
}): Promise<{ client: RegisteredClient } | { error: string; status: number }> {
  const basic = parseBasicAuth(input.authHeader);
  const clientId = basic?.clientId ?? input.bodyClientId;
  if (!clientId) return { error: "invalid_client", status: 401 };

  const client = await getClient(clientId);
  if (!client || client.disabled_at) return { error: "invalid_client", status: 401 };

  if (client.auth_method === "none") {
    if (basic?.secret || input.bodyClientSecret) {
      // Public clients must not send a secret
      return { error: "invalid_client", status: 401 };
    }
    return { client };
  }

  const secret = basic?.secret ?? input.bodyClientSecret;
  if (!secret || !client.client_secret_hash || !secretsEqual(secret, client.client_secret_hash)) {
    return { error: "invalid_client", status: 401 };
  }

  if (client.auth_method === "client_secret_basic" && !basic) {
    // Prefer basic when configured that way, but accept post as many clients send post
  }
  return { client };
}

export function clientIsConfigured(config: McpOAuthConfig = getMcpOAuthConfig()): boolean {
  return Boolean(config.clientId && config.redirectUris.length > 0);
}
