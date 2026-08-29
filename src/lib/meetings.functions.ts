import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard, requireFound } from "@/lib/server-errors";
import { Constants } from "@/integrations/supabase/types";

export const createMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        title: z.string().min(1).max(200),
        scheduledAt: z.string(),
        durationMinutes: z.number().int().min(5).max(600).default(30),
        agenda: z.string().max(5000).optional(),
        meetingUrl: z.string().url().max(500).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("meetings.create", async () => {
      const { data: meeting, error } = await context.supabase
        .from("meetings")
        .insert({
          project_id: data.projectId,
          title: data.title,
          scheduled_at: data.scheduledAt,
          duration_minutes: data.durationMinutes,
          agenda: data.agenda ?? null,
          meeting_url: data.meetingUrl ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: meeting.id };
    }),
  );

export const saveMeetingNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        meetingId: z.string().uuid(),
        notes: z.string().max(50_000),
        markCompleted: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("meetings.saveNotes", async () => {
      const { supabase } = context;
      const { data: meeting, error } = await supabase
        .from("meetings")
        .update({
          notes: data.notes,
          ...(data.markCompleted ? { status: "completed" as const } : {}),
        })
        .eq("id", data.meetingId)
        .select("id, title, project_id, status")
        .single();
      if (error) throw error;

      // Wrapping up a meeting is news for the client's feed.
      if (data.markCompleted) {
        const { error: updateError } = await supabase.from("project_updates").insert({
          project_id: meeting.project_id,
          author_id: context.userId,
          kind: "meeting_held",
          title: meeting.title,
          body: "Notes from this meeting are on the project.",
          data: { meeting_id: meeting.id },
        });
        if (updateError) throw updateError;
      }

      return { ok: true };
    }),
  );

/**
 * Commits the action items a person actually approved.
 *
 * The old flow handed the model's output straight to `tickets.insert()` in a
 * sequential loop with no confirmation and no transaction, so a mid-loop
 * failure left half the tickets created and the meeting summary unwritten.
 * These arrive already reviewed, and go in as one statement.
 */
export const commitActionItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        meetingId: z.string().uuid(),
        items: z
          .array(
            z.object({
              title: z.string().min(1).max(200),
              description: z.string().max(1000).optional(),
              type: z.enum(Constants.public.Enums.ticket_type).default("feature"),
              priority: z.enum(Constants.public.Enums.ticket_priority).default("medium"),
            }),
          )
          .min(1)
          .max(25),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("meetings.commitActionItems", async () => {
      const { supabase, userId } = context;

      const { data: meeting } = await supabase
        .from("meetings")
        .select("id, project_id")
        .eq("id", data.meetingId)
        .maybeSingle();
      const m = requireFound(meeting, "meeting");

      const { data: tickets, error: ticketError } = await supabase
        .from("tickets")
        .insert(
          data.items.map((item) => ({
            project_id: m.project_id,
            reporter_id: userId,
            title: item.title,
            description: item.description ?? null,
            type: item.type,
            priority: item.priority,
          })),
        )
        .select("id, title");
      if (ticketError) throw ticketError;

      const { error: itemError } = await supabase.from("meeting_action_items").insert(
        (tickets ?? []).map((ticket, i) => ({
          meeting_id: data.meetingId,
          ticket_id: ticket.id,
          title: data.items[i].title,
          description: data.items[i].description ?? null,
          status: "converted" as const,
        })),
      );
      if (itemError) throw itemError;

      return { created: tickets?.length ?? 0 };
    }),
  );

export const postUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        title: z.string().min(1).max(200),
        body: z.string().max(10_000).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("updates.post", async () => {
      const { error } = await context.supabase.from("project_updates").insert({
        project_id: data.projectId,
        author_id: context.userId,
        title: data.title,
        body: data.body ?? null,
        kind: "post",
      });
      if (error) throw error;
      return { ok: true };
    }),
  );
