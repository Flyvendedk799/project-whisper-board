import type { AiProvider, EmailProvider } from "./types";

/**
 * The providers that can only run on the server.
 *
 * These reach for Node: the SMTP transport imports `node:tls`, and the AI
 * provider reaches `node:crypto` through the credential store behind a person's
 * connected subscription. `providers/index.ts` cannot carry them, because it is
 * imported by browser components.
 *
 * Server functions import from here. TanStack strips a server function's handler
 * from the client build, which leaves these imports unused there — and
 * `vite.config.ts` declares `nodemailer` and `@flyvendedk799/ai-auth` free of
 * side effects for that build so Rollup is allowed to drop them. Without that
 * declaration Rollup keeps a side-effectful module even when nothing uses it,
 * and the browser bundle ends up carrying an SMTP client it can never run.
 */

export async function getEmailProvider(): Promise<EmailProvider> {
  return (await import("./email")).getEmailProvider();
}

export async function resetEmailProvider(): Promise<void> {
  (await import("./email")).resetEmailProvider();
}

/** What the deployment has configured, regardless of who is asking. */
export async function getAiProvider(): Promise<AiProvider> {
  return (await import("./ai")).getAiProvider();
}

/** The provider for one person's request — their own subscription wins. */
export async function getAiProviderFor(accountId: string): Promise<AiProvider> {
  return (await import("./ai")).getAiProviderFor(accountId);
}

export async function resetAiProvider(): Promise<void> {
  (await import("./ai")).resetAiProvider();
}
