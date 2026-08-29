import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Where client-side errors go.
 *
 * Deliberately unauthenticated: a crash during sign-in, or one caused by an
 * expired session, is exactly the kind we most want to hear about, and
 * requiring a valid session to report it would lose those. The payload is
 * capped and truncated on the way in, and the table is admin-read-only.
 */

const entry = z.object({
  fingerprint: z.string().max(200),
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  side: z.enum(["client", "server"]),
  url: z.string().max(2000).optional(),
  context: z.record(z.unknown()).optional(),
  occurredAt: z.string().datetime().optional(),
});

function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const reportErrors = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ entries: z.array(entry).max(50) }).parse(input))
  .handler(async ({ data }) => {
    if (data.entries.length === 0) return { recorded: 0 };

    // Reporting a failure must never itself become one, so this swallows.
    try {
      const { error } = await admin()
        .from("app_errors")
        .insert(
          data.entries.map((e) => ({
            fingerprint: e.fingerprint,
            message: e.message,
            stack: e.stack ?? null,
            side: e.side,
            url: e.url ?? null,
            context: (e.context ?? null) as never,
            occurred_at: e.occurredAt ?? new Date().toISOString(),
            release: process.env.APP_VERSION ?? null,
          })),
        );
      if (error) console.error("[reporting] could not record errors:", error.message);
    } catch (e) {
      console.error("[reporting] could not record errors:", e);
    }

    return { recorded: data.entries.length };
  });
