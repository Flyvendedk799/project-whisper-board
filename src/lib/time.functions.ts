import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard, requireFound } from "@/lib/server-errors";
import { AppError } from "@/lib/errors";

/**
 * "One running timer per person" is a partial unique index on time_entries, not
 * a check in here. That means two clicks racing each other produce a clean
 * unique violation, which the error mapper turns into "You already have a timer
 * running" — rather than two open timers and a puzzle later.
 */

export const startTimer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ticketId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("time.start", async () => {
      const { supabase, userId } = context;

      let projectId = data.projectId;
      if (!projectId && data.ticketId) {
        const { data: ticket } = await supabase
          .from("tickets")
          .select("project_id")
          .eq("id", data.ticketId)
          .maybeSingle();
        projectId = requireFound(ticket, "ticket").project_id;
      }
      if (!projectId) {
        throw new AppError("no_project", "Pick a ticket or a project to track time against.");
      }

      const { data: entry, error } = await supabase
        .from("time_entries")
        .insert({
          project_id: projectId,
          ticket_id: data.ticketId ?? null,
          user_id: userId,
          note: data.note ?? null,
        })
        .select("id, started_at")
        .single();
      if (error) throw error;

      return { id: entry.id, startedAt: entry.started_at };
    }),
  );

export const stopTimer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ entryId: z.string().uuid().optional(), note: z.string().max(500).optional() })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("time.stop", async () => {
      const { supabase, userId } = context;

      let entryId = data.entryId;
      if (!entryId) {
        const { data: running } = await supabase
          .from("time_entries")
          .select("id")
          .eq("user_id", userId)
          .is("ended_at", null)
          .maybeSingle();
        if (!running) throw new AppError("no_timer", "No timer is running.");
        entryId = running.id;
      }

      const { data: entry, error } = await supabase
        .from("time_entries")
        .update({
          ended_at: new Date().toISOString(),
          ...(data.note !== undefined ? { note: data.note } : {}),
        })
        .eq("id", entryId)
        .select("id, duration_minutes")
        .single();
      if (error) throw error;

      return { id: entry.id, minutes: entry.duration_minutes };
    }),
  );

export const logTime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ticketId: z.string().uuid().optional(),
        projectId: z.string().uuid(),
        minutes: z
          .number()
          .int()
          .min(1)
          .max(24 * 60),
        note: z.string().max(500).optional(),
        billable: z.boolean().default(true),
        /** Defaults to ending now, so "I just spent 45 minutes" is one field. */
        endedAt: z.string().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("time.log", async () => {
      const endedAt = data.endedAt ? new Date(data.endedAt) : new Date();
      const startedAt = new Date(endedAt.getTime() - data.minutes * 60_000);

      const { data: entry, error } = await context.supabase
        .from("time_entries")
        .insert({
          project_id: data.projectId,
          ticket_id: data.ticketId ?? null,
          user_id: context.userId,
          started_at: startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
          note: data.note ?? null,
          billable: data.billable,
        })
        .select("id, duration_minutes")
        .single();
      if (error) throw error;

      return { id: entry.id, minutes: entry.duration_minutes };
    }),
  );

export const deleteTimeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ entryId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("time.delete", async () => {
      const { data: entry } = await context.supabase
        .from("time_entries")
        .select("id, invoice_id")
        .eq("id", data.entryId)
        .maybeSingle();
      const found = requireFound(entry, "time entry");

      if (found.invoice_id) {
        throw new AppError(
          "already_invoiced",
          "That time is already on an invoice. Void the invoice first.",
        );
      }

      const { error } = await context.supabase.from("time_entries").delete().eq("id", data.entryId);
      if (error) throw error;
      return { ok: true };
    }),
  );
