import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAiProviderFor } from "@/lib/providers/server";
import { AppError } from "@/lib/errors";
import { guard, requireFound } from "@/lib/server-errors";
import { Constants } from "@/integrations/supabase/types";
import type { AiMessage } from "@/lib/providers";

/**
 * AI, through the provider adapter rather than a hardcoded gateway.
 *
 * Two failure modes are fixed here beyond the vendor lock:
 *
 *  - `summarizeTicket` used to `.insert()` into ai_summaries, which has a
 *    unique key on (subject_type, subject_id), and never checked the result.
 *    The second summarize of any ticket failed silently, forever. It upserts.
 *  - Both JSON-mode handlers had `catch { }` around the parse and then fell
 *    back to the existing values, so a total model failure was indistinguishable
 *    from the model agreeing with you. Now it says so.
 */

const TICKET_TYPES = Constants.public.Enums.ticket_type;
const TICKET_PRIORITIES = Constants.public.Enums.ticket_priority;

/** Never trust the model's shape — validate before anything reaches the database. */
function parseJson<T>(raw: string, schema: z.ZodType<T>, what: string): T {
  let parsed: unknown;
  try {
    // Models sometimes wrap JSON in a fenced block despite being asked not to.
    const unwrapped = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    parsed = JSON.parse(unwrapped);
  } catch {
    throw new AppError("ai_parse", `The AI's answer wasn't readable. Try ${what} again.`, {
      status: 502,
      context: { raw: raw.slice(0, 500) },
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AppError("ai_shape", `The AI's answer wasn't usable. Try ${what} again.`, {
      status: 502,
      context: { issues: result.error.issues.slice(0, 5) },
    });
  }
  return result.data;
}

export const summarizeTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("ai.summarizeTicket", async () => {
      const { supabase } = context;
      const ai = await getAiProviderFor(context.userId);

      const { data: ticket } = await supabase
        .from("tickets")
        .select("title, description, type, priority, status")
        .eq("id", data.ticketId)
        .maybeSingle();
      const t = requireFound(ticket, "ticket");

      const { data: comments } = await supabase
        .from("ticket_comments")
        .select("body, is_internal, created_at")
        .eq("ticket_id", data.ticketId)
        .order("created_at");

      const thread = [
        `Title: ${t.title}`,
        `Type: ${t.type} · Priority: ${t.priority} · Status: ${t.status}`,
        `Description: ${t.description ?? "(none)"}`,
        "",
        "Thread:",
        ...(comments ?? []).map((c) => `- ${c.is_internal ? "[internal] " : ""}${c.body}`),
      ].join("\n");

      const summary = await ai.chat([
        {
          role: "system",
          content:
            "You summarize a software support ticket for the developer who has to pick it up. " +
            "Three to five bullets, plain text, no markdown headers: what is wrong or being asked " +
            "for, what has already been tried, and what is blocking. Say what is actually in the " +
            "thread — never speculate.",
        },
        { role: "user", content: thread },
      ]);

      const { error: ticketError } = await supabase
        .from("tickets")
        .update({ ai_summary: summary })
        .eq("id", data.ticketId);
      if (ticketError) throw ticketError;

      // Upsert, not insert: ai_summaries is unique on (subject_type, subject_id).
      const { error: cacheError } = await supabase
        .from("ai_summaries")
        .upsert(
          { subject_id: data.ticketId, subject_type: "ticket", summary },
          { onConflict: "subject_type,subject_id" },
        );
      if (cacheError) throw cacheError;

      return { summary };
    }),
  );

export const draftReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("ai.draftReply", async () => {
      const { supabase } = context;
      const ai = await getAiProviderFor(context.userId);

      const { data: ticket } = await supabase
        .from("tickets")
        .select("title, description, status, eta_date")
        .eq("id", data.ticketId)
        .maybeSingle();
      const t = requireFound(ticket, "ticket");

      const { data: comments } = await supabase
        .from("ticket_comments")
        .select("body, is_internal")
        .eq("ticket_id", data.ticketId)
        .order("created_at");

      const reply = await ai.chat([
        {
          role: "system",
          content:
            "Draft the developer's next reply to their client on this ticket. Two to four " +
            "sentences, warm but not chatty, no greeting or sign-off, no markdown. Say what is " +
            "happening and what happens next. Never promise a date that is not already in the " +
            "ticket, and never claim something is fixed unless the thread says it is.",
        },
        {
          role: "user",
          content: [
            `Ticket: ${t.title}`,
            t.eta_date ? `ETA already given to the client: ${t.eta_date}` : "",
            "",
            t.description ?? "",
            "",
            (comments ?? [])
              .map((c) => `${c.is_internal ? "[internal note] " : ""}${c.body}`)
              .join("\n---\n"),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ]);

      return { reply };
    }),
  );

const triageSchema = z.object({
  type: z.enum(TICKET_TYPES),
  priority: z.enum(TICKET_PRIORITIES),
  reasoning: z.string().max(500),
});

export const autoTriageTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("ai.autoTriageTicket", async () => {
      const { supabase } = context;
      const ai = await getAiProviderFor(context.userId);

      const { data: ticket } = await supabase
        .from("tickets")
        .select("title, description, type, priority")
        .eq("id", data.ticketId)
        .maybeSingle();
      const t = requireFound(ticket, "ticket");

      const raw = await ai.chat(
        [
          {
            role: "system",
            content:
              "You triage a software support ticket. Reply with strict JSON and nothing else: " +
              `{"type":"${TICKET_TYPES.join("|")}","priority":"${TICKET_PRIORITIES.join("|")}",` +
              '"reasoning":"<one sentence>"}. Reserve "urgent" for something that blocks the ' +
              "client's customers or their revenue right now.",
          },
          { role: "user", content: `Title: ${t.title}\n\nDescription: ${t.description ?? ""}` },
        ],
        { json: true },
      );

      const suggestion = parseJson(raw, triageSchema, "triaging");

      const { error } = await supabase
        .from("tickets")
        .update({
          ai_suggested_type: suggestion.type,
          ai_suggested_priority: suggestion.priority,
        })
        .eq("id", data.ticketId);
      if (error) throw error;

      return suggestion;
    }),
  );

export const analyzeScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ ticketId: z.string().uuid(), attachmentId: z.string().uuid() }).parse(input),
  )
  .handler(({ data, context }) =>
    guard("ai.analyzeScreenshot", async () => {
      const { supabase } = context;
      const ai = await getAiProviderFor(context.userId);

      const { data: attachment } = await supabase
        .from("ticket_attachments")
        .select("storage_bucket, storage_path, mime_type, size_bytes")
        .eq("id", data.attachmentId)
        .maybeSingle();
      const att = requireFound(attachment, "attachment");

      if (!att.mime_type?.startsWith("image/")) {
        throw new AppError("not_an_image", "That attachment isn't an image.");
      }
      // Base64 inflates by a third and the whole thing sits in Worker memory
      // alongside the original buffer, so cap it well below the 128MB limit.
      if ((att.size_bytes ?? 0) > 8 * 1024 * 1024) {
        throw new AppError(
          "image_too_large",
          "That image is too large to analyse. Under 8 MB works best.",
        );
      }

      const { data: signed } = await supabase.storage
        .from(att.storage_bucket)
        .createSignedUrl(att.storage_path, 300);
      if (!signed?.signedUrl) throw new AppError("sign_failed", "Couldn't open that attachment.");

      const response = await fetch(signed.signedUrl);
      if (!response.ok) throw new AppError("fetch_failed", "Couldn't open that attachment.");

      const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
      const messages: AiMessage[] = [
        {
          role: "system",
          content:
            "You are looking at a screenshot from a bug report. In two to four sentences: what is " +
            "on screen, any visible error or broken layout, and what the person was most likely " +
            "trying to do. If the reporter drew arrows or boxes, they are pointing at the problem.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyse this screenshot:" },
            { type: "image_url", image_url: { url: `data:${att.mime_type};base64,${base64}` } },
          ],
        },
      ];

      const analysis = await ai.chat(messages);

      const { error } = await supabase
        .from("tickets")
        .update({ ai_screenshot_analysis: analysis })
        .eq("id", data.ticketId);
      if (error) throw error;

      return { analysis };
    }),
  );

const actionItemsSchema = z.object({
  summary: z.string().max(2000),
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        type: z.enum(TICKET_TYPES).optional(),
        priority: z.enum(TICKET_PRIORITIES).optional(),
      }),
    )
    .max(25),
});

export type ProposedActionItem = z.infer<typeof actionItemsSchema>["items"][number];

/**
 * Proposes action items and writes nothing.
 *
 * This used to create tickets directly from a model's output, in a
 * non-transactional loop, with no confirmation step — and the
 * meeting_action_items rows it produced were never rendered anywhere, so you
 * could not see what it had done. Now it returns a proposal for review, and a
 * separate call commits whatever survives it.
 */
export const proposeActionItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ meetingId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("ai.proposeActionItems", async () => {
      const { supabase } = context;
      const ai = await getAiProviderFor(context.userId);

      const { data: meeting } = await supabase
        .from("meetings")
        .select("project_id, title, notes")
        .eq("id", data.meetingId)
        .maybeSingle();
      const m = requireFound(meeting, "meeting");

      if (!m.notes?.trim()) {
        throw new AppError("no_notes", "Write some notes first — there's nothing to extract yet.");
      }

      const raw = await ai.chat(
        [
          {
            role: "system",
            content:
              "Extract the action items from these meeting notes. Reply with strict JSON and " +
              'nothing else: {"summary":"<2-3 sentence recap>","items":[{"title":"<short, ' +
              'imperative>","description":"<one sentence>","type":"' +
              TICKET_TYPES.join("|") +
              '","priority":"' +
              TICKET_PRIORITIES.join("|") +
              '"}]}. Only include things somebody actually committed to doing. ' +
              "Discussion without a decision is not an action item.",
          },
          { role: "user", content: `Meeting: ${m.title}\n\nNotes:\n${m.notes}` },
        ],
        { json: true },
      );

      const proposal = parseJson(raw, actionItemsSchema, "extracting action items");

      const { error } = await supabase
        .from("meetings")
        .update({ ai_summary: proposal.summary })
        .eq("id", data.meetingId);
      if (error) throw error;

      return { ...proposal, projectId: m.project_id };
    }),
  );
