import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const createMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      projectId: z.string().uuid(),
      title: z.string().min(1).max(200),
      scheduledAt: z.string(),
      durationMinutes: z.number().int().min(5).max(600).default(30),
      agenda: z.string().max(5000).optional(),
      meetingUrl: z.string().url().max(500).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: m, error } = await context.supabase
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
    if (error) throw new Error(error.message);
    return { id: m.id };
  });

export const saveMeetingNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      meetingId: z.string().uuid(),
      notes: z.string().max(50_000),
      markCompleted: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const update: any = { notes: data.notes };
    if (data.markCompleted) update.status = "completed";
    const { error } = await context.supabase.from("meetings").update(update).eq("id", data.meetingId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const postUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      projectId: z.string().uuid(),
      title: z.string().min(1).max(200),
      body: z.string().max(10_000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("project_updates").insert({
      project_id: data.projectId,
      author_id: context.userId,
      title: data.title,
      body: data.body ?? null,
      kind: "post",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
