import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard } from "@/lib/server-errors";
import type { ClaudeConnection } from "@/lib/ai-auth/claude";

/**
 * Connecting your own Claude subscription.
 *
 * `ai-auth` ships these as Fastify routes plus a React component that calls them
 * with `credentials: 'same-origin'`. This app is neither Fastify nor
 * cookie-authenticated — the Supabase session lives in localStorage and travels
 * as a bearer token — so the four operations are server functions behind the
 * app's own auth middleware instead, over the same library core.
 *
 * Anyone signed in may connect an account. Whose plan pays is the user's own
 * decision, and a per-user credential only an admin could install would defeat
 * the point of having one.
 *
 * No token ever crosses to the browser: a code goes up, a status comes back.
 *
 * The module behind this is imported inside each handler, never at the top.
 * `@flyvendedk799/ai-auth` imports `node:crypto` by name, and a top-level import
 * survives the client-side strip of these handlers and fails the browser build —
 * the failure the library's own README warns about. A type-only import is fine;
 * it is erased.
 */

export const claudeConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClaudeConnection> => {
    const { claudeStatusFor } = await import("@/lib/ai-auth/claude");
    return guard("claude.status", () => claudeStatusFor(context.userId));
  });

export const startClaudeConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string; expiresInSeconds: number }> => {
    const { beginClaudeLogin } = await import("@/lib/ai-auth/claude");
    return guard("claude.login", async () => beginClaudeLogin(context.userId));
  });

export const finishClaudeConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      // The authorize page hands back `code#state`, and people paste it with
      // whitespace, wrapped, or as the whole URL. The library sorts that out;
      // only a genuinely empty paste is refused here.
      code: z.string().trim().min(1, "Paste the code from the Claude page."),
    }),
  )
  .handler(async ({ context, data }): Promise<ClaudeConnection> => {
    const { completeClaudeLogin } = await import("@/lib/ai-auth/claude");
    return guard("claude.login.complete", () => completeClaudeLogin(context.userId, data.code));
  });

export const removeClaudeConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClaudeConnection> => {
    const { disconnectClaude } = await import("@/lib/ai-auth/claude");
    return guard("claude.disconnect", () => disconnectClaude(context.userId));
  });
