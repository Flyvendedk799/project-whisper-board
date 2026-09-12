import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAiProviderFor } from "@/lib/providers/server";
import { AppError } from "@/lib/errors";
import { guard } from "@/lib/server-errors";
import { Constants } from "@/integrations/supabase/types";
import type { AiContent, AiMessage } from "@/lib/providers";

/**
 * Writes the ticket from the capture.
 *
 * This is the point of the whole reporting flow. A client should not have to
 * produce a title, a type, a priority and reproduction steps — they should be
 * able to point at the problem and describe it in a sentence. The model gets
 * the screenshots, whatever they typed, and the browser context, and proposes
 * the rest for them to confirm.
 */

const TICKET_TYPES = Constants.public.Enums.ticket_type;
const TICKET_PRIORITIES = Constants.public.Enums.ticket_priority;

const draftSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(TICKET_TYPES),
  priority: z.enum(TICKET_PRIORITIES),
  summary: z.string().max(2000),
  steps_to_reproduce: z.array(z.string().max(300)).max(12).default([]),
  expected: z.string().max(500).optional(),
  actual: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type ComposedDraft = z.infer<typeof draftSchema>;

const SYSTEM_PROMPT = [
  "You turn a client's rough bug report into one a developer can act on.",
  "",
  "You are given whatever the client typed, technical details their browser",
  "reported, and any screenshots they attached. Arrows, boxes and highlights",
  "drawn on a screenshot are the client pointing at the problem — treat them as",
  "the most important thing in the image. Blurred areas were deliberately",
  "hidden; do not speculate about what was under them.",
  "",
  "Reply with strict JSON and nothing else:",
  '{"title":"<one line, specific, no ticket prefix>",',
  `"type":"${TICKET_TYPES.join("|")}",`,
  `"priority":"${TICKET_PRIORITIES.join("|")}",`,
  '"summary":"<2-3 sentences in the client\'s own register, not jargon>",',
  '"steps_to_reproduce":["<what they did, in order>"],',
  '"expected":"<what they thought would happen>",',
  '"actual":"<what happened instead>",',
  '"confidence":<0..1>}',
  "",
  "Rules. Describe only what you can see or were told — never invent a step, an",
  "error message or a browser. If the report is too vague to reconstruct, say so",
  "in the summary and set confidence below 0.4. Reserve 'urgent' for something",
  "blocking the client's own customers or their money right now; a cosmetic",
  "problem is 'low' however annoyed the report sounds.",
].join("\n");

export const composeTicketFromCapture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        note: z.string().max(5000).optional(),
        /** Already-uploaded attachments to look at. */
        attachmentIds: z.array(z.string().uuid()).max(4).default([]),
        /** Not-yet-uploaded images, as data URLs, capped to keep the Worker sane. */
        inlineImages: z.array(z.string().max(8_000_000)).max(3).default([]),
        context: z.record(z.unknown()).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("ai.composeTicket", async () => {
      const { supabase } = context;
      const ai = await getAiProviderFor(context.userId);

      if (!ai.enabled) {
        throw new AppError(
          "ai_disabled",
          "AI drafting isn't set up on this workspace — write what you can and send it.",
          { status: 501 },
        );
      }

      const images: string[] = [...data.inlineImages];

      if (data.attachmentIds.length > 0) {
        const { data: attachments } = await supabase
          .from("ticket_attachments")
          .select("storage_bucket, storage_path, mime_type, size_bytes")
          .in("id", data.attachmentIds);

        for (const attachment of attachments ?? []) {
          if (!attachment.mime_type?.startsWith("image/")) continue;
          if ((attachment.size_bytes ?? 0) > 8 * 1024 * 1024) continue;

          const { data: signed } = await supabase.storage
            .from(attachment.storage_bucket)
            .createSignedUrl(attachment.storage_path, 300);
          if (!signed?.signedUrl) continue;

          const response = await fetch(signed.signedUrl);
          if (!response.ok) continue;
          const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
          images.push(`data:${attachment.mime_type};base64,${base64}`);
        }
      }

      const told = [
        data.note?.trim() ? `What they wrote:\n${data.note.trim()}` : "They didn't write anything.",
        data.context ? `\nTechnical details:\n${describeContext(data.context)}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const content: AiContent =
        images.length > 0
          ? [
              { type: "text" as const, text: told },
              ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
            ]
          : told;

      const messages: AiMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ];

      const raw = await ai.chat(messages, { json: true });

      let parsed: unknown;
      try {
        parsed = JSON.parse(
          raw
            .trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, ""),
        );
      } catch {
        throw new AppError(
          "ai_parse",
          "The AI couldn't make sense of that. Write what you can and send it — we'll take it from there.",
          { status: 502 },
        );
      }

      const result = draftSchema.safeParse(parsed);
      if (!result.success) {
        throw new AppError(
          "ai_shape",
          "The AI's draft wasn't usable. Write what you can and send it — we'll take it from there.",
          { status: 502, context: { issues: result.error.issues.slice(0, 5) } },
        );
      }

      return result.data;
    }),
  );

/** Flattens the captured context into something worth spending tokens on. */
function describeContext(context: Record<string, unknown>): string {
  const lines: string[] = [];
  const say = (label: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "")
      lines.push(`${label}: ${String(value)}`);
  };

  say("Page", context.url);
  say("Page title", context.pageTitle);
  say("Browser", [context.browser, context.browserVersion].filter(Boolean).join(" "));
  say("OS", context.os);
  say("Device", context.deviceType);
  if (context.viewportW && context.viewportH) {
    say("Window size", `${context.viewportW}x${context.viewportH}`);
  }
  say("Online", context.online);

  const consoleLog = context.consoleLog;
  if (Array.isArray(consoleLog) && consoleLog.length > 0) {
    lines.push("\nRecent console output (newest last):");
    for (const entry of consoleLog.slice(-15)) {
      if (entry && typeof entry === "object" && "message" in entry) {
        const e = entry as { level?: string; message?: string };
        lines.push(`  [${e.level ?? "log"}] ${String(e.message).slice(0, 300)}`);
      }
    }
  }

  const networkErrors = context.networkErrors;
  if (Array.isArray(networkErrors) && networkErrors.length > 0) {
    lines.push("\nRequests that failed:");
    for (const entry of networkErrors.slice(-10)) {
      if (entry && typeof entry === "object" && "url" in entry) {
        const e = entry as { method?: string; status?: number; url?: string };
        lines.push(
          `  ${e.method ?? "GET"} ${e.url} -> ${e.status === 0 ? "no response" : e.status}`,
        );
      }
    }
  }

  return lines.join("\n");
}
