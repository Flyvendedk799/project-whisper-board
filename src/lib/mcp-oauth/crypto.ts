import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { TOKEN_PREFIX } from "./config";

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(prefix: keyof typeof TOKEN_PREFIX): {
  plaintext: string;
  hash: string;
} {
  const raw = randomBytes(32).toString("base64url");
  const plaintext = `${TOKEN_PREFIX[prefix]}${raw}`;
  return { plaintext, hash: sha256Hex(plaintext) };
}

export function randomNonce(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString("base64url");
  return { plaintext, hash: sha256Hex(plaintext) };
}

/** S256 code challenge from a verifier (BASE64URL(SHA256(verifier)) without padding). */
export function pkceChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export function hashSecret(secret: string): string {
  return sha256Hex(secret);
}
