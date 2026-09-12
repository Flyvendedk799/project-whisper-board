import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard } from "@/lib/server-errors";
import { getErrorTracker, getPaymentsProvider } from "@/lib/providers";
import { getAiProvider, getEmailProvider } from "@/lib/providers/server";

/**
 * What is actually configured, and what the placeholders have been doing.
 *
 * Surfacing this matters: without it, "email is set up" and "email is being
 * quietly recorded to a table" look identical from inside the app.
 */
export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(() =>
    guard("admin.integrationStatus", async () => {
      const email = await getEmailProvider();
      const payments = getPaymentsProvider();
      const errors = getErrorTracker();
      const ai = await getAiProvider();

      return {
        email: { name: email.name, enabled: email.enabled },
        payments: { name: payments.name, enabled: payments.enabled },
        errors: { name: errors.name, enabled: errors.enabled },
        ai: { name: ai.name, enabled: ai.enabled, model: ai.model },
      };
    }),
  );

export const listOutbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ limit: z.number().int().min(1).max(100).default(50) }).parse(input),
  )
  .handler(({ data, context }) =>
    guard("admin.outbox", async () => {
      const { data: rows, error } = await context.supabase
        .from("outbound_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(data.limit);
      if (error) throw error;
      return rows ?? [];
    }),
  );

export const listAppErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(input),
  )
  .handler(({ data, context }) =>
    guard("admin.appErrors", async () => {
      const { data: rows, error } = await context.supabase
        .from("app_errors")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(data.limit);
      if (error) throw error;

      // Grouped by fingerprint: forty copies of one bug is one problem.
      const groups = new Map<
        string,
        { fingerprint: string; message: string; count: number; lastSeen: string; side: string }
      >();
      for (const row of rows ?? []) {
        const existing = groups.get(row.fingerprint);
        if (existing) {
          existing.count += 1;
          if (row.occurred_at > existing.lastSeen) existing.lastSeen = row.occurred_at;
        } else {
          groups.set(row.fingerprint, {
            fingerprint: row.fingerprint,
            message: row.message,
            count: 1,
            lastSeen: row.occurred_at,
            side: row.side,
          });
        }
      }

      return [...groups.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    }),
  );
