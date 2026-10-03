import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard, requireFound } from "@/lib/server-errors";
import { AppError } from "@/lib/errors";
import { purgeFiles } from "@/lib/storage-purge";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

/** Invoices in these states have been shown to a client, so they are not ours to erase. */
const ISSUED_INVOICE_STATUSES = ["sent", "paid", "overdue"] as const;

export type ProjectDeletionImpact = {
  tickets: number;
  milestones: number;
  meetings: number;
  updates: number;
  timeEntries: number;
  quotes: number;
  invoices: number;
  /** Sent, paid or overdue. Any of these stops the delete. */
  issuedInvoices: number;
  /** Plans linked to the project. They survive, unlinked. */
  plans: number;
};

async function countRows(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function projectImpact(supabase: Client, projectId: string): Promise<ProjectDeletionImpact> {
  const head = { count: "exact", head: true } as const;
  const [
    tickets,
    milestones,
    meetings,
    updates,
    timeEntries,
    quotes,
    invoices,
    issuedInvoices,
    plans,
  ] = await Promise.all([
    countRows(supabase.from("tickets").select("id", head).eq("project_id", projectId)),
    countRows(supabase.from("milestones").select("id", head).eq("project_id", projectId)),
    countRows(supabase.from("meetings").select("id", head).eq("project_id", projectId)),
    countRows(supabase.from("project_updates").select("id", head).eq("project_id", projectId)),
    countRows(supabase.from("time_entries").select("id", head).eq("project_id", projectId)),
    countRows(supabase.from("quotes").select("id", head).eq("project_id", projectId)),
    countRows(supabase.from("invoices").select("id", head).eq("project_id", projectId)),
    countRows(
      supabase
        .from("invoices")
        .select("id", head)
        .eq("project_id", projectId)
        .in("status", [...ISSUED_INVOICE_STATUSES]),
    ),
    countRows(supabase.from("plans").select("id", head).eq("project_id", projectId)),
  ]);
  return {
    tickets,
    milestones,
    meetings,
    updates,
    timeEntries,
    quotes,
    invoices,
    issuedInvoices,
    plans,
  };
}

/** What deleting this project would take with it, for the confirmation to say out loud. */
export const getProjectDeletionImpact = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("projects.deletionImpact", async () => {
      const { data: project } = await context.supabase
        .from("projects")
        .select("id")
        .eq("id", data.projectId)
        .maybeSingle();
      requireFound(project, "project");
      return projectImpact(context.supabase, data.projectId);
    }),
  );

/**
 * Deletes a project and everything filed under it.
 *
 * Tickets, milestones, meetings, updates, time, quotes and invoices go with the
 * row (their foreign keys cascade). Plans do not: they are unlinked and stay in
 * the Planner. Issued invoices are the exception that stops the delete, because
 * a client has already seen them; archive the project to take it out of sight.
 * Files that tickets uploaded are removed from storage afterwards, best effort,
 * since a cascade only reaches rows.
 */
export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("projects.delete", async () => {
      const { supabase } = context;
      const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("id", data.projectId)
        .maybeSingle();
      requireFound(project, "project");

      const impact = await projectImpact(supabase, data.projectId);
      if (impact.issuedInvoices > 0) {
        const n = impact.issuedInvoices;
        throw new AppError(
          "project_has_issued_invoices",
          `This project has ${n} issued invoice${n === 1 ? "" : "s"}. Billing records are kept, so archive the project instead of deleting it.`,
          { status: 409 },
        );
      }

      const { data: files, error: filesError } = await supabase
        .from("ticket_attachments")
        .select("storage_bucket, storage_path, tickets!inner(project_id)")
        .eq("tickets.project_id", data.projectId);
      if (filesError) throw filesError;

      const { data: removed, error } = await supabase
        .from("projects")
        .delete()
        .eq("id", data.projectId)
        .select("id");
      if (error) throw error;
      if (!removed?.length) {
        throw new AppError("forbidden", "Only workspace admins can delete a project.", {
          status: 403,
        });
      }

      await purgeFiles(files ?? []);
      return { ok: true };
    }),
  );
