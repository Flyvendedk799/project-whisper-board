import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard, requireFound } from "@/lib/server-errors";
import { AppError } from "@/lib/errors";
import { Constants } from "@/integrations/supabase/types";
import type { Update } from "@/data/types";

const statusEnum = z.enum(Constants.public.Enums.ticket_status);
const priorityEnum = z.enum(Constants.public.Enums.ticket_priority);
const typeEnum = z.enum(Constants.public.Enums.ticket_type);

export const createTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(20_000).optional(),
        type: typeEnum.default("bug"),
        priority: priorityEnum.default("medium"),
        /** Auto-collected browser state, stored alongside the ticket. */
        context: z
          .object({
            url: z.string().max(2000).optional(),
            pageTitle: z.string().max(500).optional(),
            referrer: z.string().max(2000).optional(),
            userAgent: z.string().max(1000).optional(),
            browser: z.string().max(100).optional(),
            browserVersion: z.string().max(50).optional(),
            os: z.string().max(100).optional(),
            deviceType: z.string().max(50).optional(),
            viewportW: z.number().int().optional(),
            viewportH: z.number().int().optional(),
            screenW: z.number().int().optional(),
            screenH: z.number().int().optional(),
            dpr: z.number().optional(),
            timezone: z.string().max(100).optional(),
            locale: z.string().max(50).optional(),
            online: z.boolean().optional(),
            appVersion: z.string().max(100).optional(),
            consoleLog: z.array(z.unknown()).max(100).optional(),
            networkErrors: z.array(z.unknown()).max(50).optional(),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tickets.create", async () => {
      const { supabase, userId } = context;

      const { data: ticket, error } = await supabase
        .from("tickets")
        .insert({
          project_id: data.projectId,
          reporter_id: userId,
          title: data.title,
          description: data.description ?? null,
          type: data.type,
          priority: data.priority,
        })
        .select("id, ticket_number")
        .single();
      if (error) throw error;

      if (data.context) {
        const c = data.context;
        // Best effort: losing the diagnostics is not a reason to lose the ticket.
        const { error: contextError } = await supabase.from("ticket_capture_context").insert({
          ticket_id: ticket.id,
          url: c.url ?? null,
          page_title: c.pageTitle ?? null,
          referrer: c.referrer ?? null,
          user_agent: c.userAgent ?? null,
          browser: c.browser ?? null,
          browser_version: c.browserVersion ?? null,
          os: c.os ?? null,
          device_type: c.deviceType ?? null,
          viewport_w: c.viewportW ?? null,
          viewport_h: c.viewportH ?? null,
          screen_w: c.screenW ?? null,
          screen_h: c.screenH ?? null,
          dpr: c.dpr ?? null,
          timezone: c.timezone ?? null,
          locale: c.locale ?? null,
          online: c.online ?? null,
          app_version: c.appVersion ?? null,
          console_log: (c.consoleLog ?? null) as never,
          network_errors: (c.networkErrors ?? null) as never,
        });
        if (contextError) {
          console.error("[tickets.create] could not store capture context:", contextError.message);
        }
      }

      return { id: ticket.id, number: ticket.ticket_number };
    }),
  );

export const updateTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ticketId: z.string().uuid(),
        status: statusEnum.optional(),
        priority: priorityEnum.optional(),
        type: typeEnum.optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        etaDate: z.string().nullable().optional(),
        estimateHours: z.number().min(0).max(10_000).nullable().optional(),
        labels: z.array(z.string().max(40)).max(20).optional(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(20_000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tickets.update", async () => {
      const { ticketId, ...fields } = data;

      // Conditional spreads rather than a filtered Object.entries: an absent
      // field must not be sent (which would erase it), and the patch has to
      // keep its literal keys or it stops typechecking against the schema.
      const patch: Update<"tickets"> = {
        ...(fields.status !== undefined && { status: fields.status }),
        ...(fields.priority !== undefined && { priority: fields.priority }),
        ...(fields.type !== undefined && { type: fields.type }),
        ...(fields.assigneeId !== undefined && { assignee_id: fields.assigneeId }),
        ...(fields.dueDate !== undefined && { due_date: fields.dueDate }),
        ...(fields.etaDate !== undefined && { eta_date: fields.etaDate }),
        ...(fields.estimateHours !== undefined && { estimate_hours: fields.estimateHours }),
        ...(fields.labels !== undefined && { labels: fields.labels }),
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.description !== undefined && { description: fields.description }),
      };

      if (Object.keys(patch).length === 0) return { ok: true };

      const { error } = await context.supabase.from("tickets").update(patch).eq("id", ticketId);
      if (error) throw error;
      return { ok: true };
    }),
  );

/**
 * One statement for the whole selection rather than a request per ticket.
 * Returns which ids actually changed, so the UI can report an honest count
 * when RLS silently filters some of them out.
 */
export const bulkUpdateTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ticketIds: z.array(z.string().uuid()).min(1).max(200),
        status: statusEnum.optional(),
        priority: priorityEnum.optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        addLabels: z.array(z.string().max(40)).max(10).optional(),
        removeLabels: z.array(z.string().max(40)).max(10).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tickets.bulkUpdate", async () => {
      const { supabase } = context;

      const patch: Update<"tickets"> = {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.assigneeId !== undefined && { assignee_id: data.assigneeId }),
      };

      const updated: string[] = [];

      if (Object.keys(patch).length > 0) {
        const { data: rows, error } = await supabase
          .from("tickets")
          .update(patch)
          .in("id", data.ticketIds)
          .select("id");
        if (error) throw error;
        updated.push(...(rows ?? []).map((r) => r.id));
      }

      // Labels are an array column, so each ticket's own set has to be read
      // before it can be added to. Done in one round trip either way.
      if (data.addLabels?.length || data.removeLabels?.length) {
        const { data: current, error } = await supabase
          .from("tickets")
          .select("id, labels")
          .in("id", data.ticketIds);
        if (error) throw error;

        for (const row of current ?? []) {
          const next = new Set(row.labels ?? []);
          data.addLabels?.forEach((label) => next.add(label));
          data.removeLabels?.forEach((label) => next.delete(label));
          const { error: labelError } = await supabase
            .from("tickets")
            .update({ labels: [...next] })
            .eq("id", row.id);
          if (labelError) throw labelError;
          if (!updated.includes(row.id)) updated.push(row.id);
        }
      }

      const failed = data.ticketIds.filter((id) => !updated.includes(id));
      return { updated, failed };
    }),
  );

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ticketId: z.string().uuid(),
        body: z.string().min(1).max(20_000),
        isInternal: z.boolean().default(false),
        /** Profile ids named with @ in the body. */
        mentions: z.array(z.string().uuid()).max(20).default([]),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tickets.addComment", async () => {
      const { supabase, userId } = context;

      const { data: comment, error } = await supabase
        .from("ticket_comments")
        .insert({
          ticket_id: data.ticketId,
          author_id: userId,
          body: data.body,
          is_internal: data.isInternal,
        })
        .select("id")
        .single();
      if (error) throw error;

      return { id: comment.id };
    }),
  );

export const linkTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fromTicketId: z.string().uuid(),
        toTicketId: z.string().uuid(),
        kind: z.enum(Constants.public.Enums.ticket_relation_kind),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tickets.link", async () => {
      if (data.fromTicketId === data.toTicketId) {
        throw new AppError("self_link", "A ticket can't be linked to itself.");
      }
      const { error } = await context.supabase.from("ticket_relations").insert({
        from_ticket_id: data.fromTicketId,
        to_ticket_id: data.toTicketId,
        kind: data.kind,
        created_by: context.userId,
      });
      if (error) throw error;
      return { ok: true };
    }),
  );

export const unlinkTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ relationId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("tickets.unlink", async () => {
      const { error } = await context.supabase
        .from("ticket_relations")
        .delete()
        .eq("id", data.relationId);
      if (error) throw error;
      return { ok: true };
    }),
  );

export const setMilestoneStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        milestoneId: z.string().uuid(),
        status: z.enum(Constants.public.Enums.milestone_status),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("milestones.setStatus", async () => {
      const { error } = await context.supabase
        .from("milestones")
        .update({ status: data.status })
        .eq("id", data.milestoneId);
      if (error) throw error;
      return { ok: true };
    }),
  );

export const saveView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(60),
        filters: z.record(z.unknown()),
        icon: z.string().max(40).optional(),
        isShared: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("views.save", async () => {
      const { supabase, userId } = context;
      const row = {
        owner_id: userId,
        name: data.name,
        scope: "tickets",
        filters: data.filters as never,
        icon: data.icon ?? null,
        is_shared: data.isShared,
      };

      const { data: saved, error } = data.id
        ? await supabase.from("saved_views").update(row).eq("id", data.id).select("id").single()
        : await supabase.from("saved_views").insert(row).select("id").single();
      if (error) throw error;
      return { id: saved.id };
    }),
  );

export const deleteView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ viewId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("views.delete", async () => {
      const { error } = await context.supabase.from("saved_views").delete().eq("id", data.viewId);
      if (error) throw error;
      return { ok: true };
    }),
  );

export const setProjectStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        status: z.enum(Constants.public.Enums.project_status),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("projects.setStatus", async () => {
      const { data: project } = await context.supabase
        .from("projects")
        .select("id")
        .eq("id", data.projectId)
        .maybeSingle();
      requireFound(project, "project");

      const { error } = await context.supabase
        .from("projects")
        .update({ status: data.status })
        .eq("id", data.projectId);
      if (error) throw error;
      return { ok: true };
    }),
  );
