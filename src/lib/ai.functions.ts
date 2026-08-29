import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function callAI(messages: Array<{ role: string; content: any }>, opts?: { json?: boolean }) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages,
      ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("AI rate limit reached. Try again shortly.");
    if (res.status === 402)
      throw new Error("AI credits exhausted. Add funds in workspace settings.");
    throw new Error(`AI error ${res.status}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

export const summarizeTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: t } = await supabase
      .from("tickets")
      .select("title,description,type,priority,status")
      .eq("id", data.ticketId)
      .maybeSingle();
    if (!t) throw new Error("Not found");
    const { data: comments } = await supabase
      .from("ticket_comments")
      .select("body,created_at")
      .eq("ticket_id", data.ticketId)
      .order("created_at");
    const text = [
      `Title: ${t.title}`,
      `Type: ${t.type} · Priority: ${t.priority} · Status: ${t.status}`,
      `Description: ${t.description ?? "(none)"}`,
      "",
      "Thread:",
      ...(comments ?? []).map((c) => `- ${c.body}`),
    ].join("\n");
    const summary = await callAI([
      {
        role: "system",
        content:
          "You are a concise project assistant. Summarize this support ticket in 3-5 bullets: what's broken/asked, what's been tried, what's blocked. Plain text, no markdown headers.",
      },
      { role: "user", content: text },
    ]);
    await supabase.from("tickets").update({ ai_summary: summary }).eq("id", data.ticketId);
    await supabase
      .from("ai_summaries")
      .insert({ subject_id: data.ticketId, subject_type: "ticket", summary });
    return { summary };
  });

export const draftReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: t } = await supabase
      .from("tickets")
      .select("title,description,status")
      .eq("id", data.ticketId)
      .maybeSingle();
    const { data: comments } = await supabase
      .from("ticket_comments")
      .select("body")
      .eq("ticket_id", data.ticketId)
      .order("created_at");
    const reply = await callAI([
      {
        role: "system",
        content:
          "Draft a short, friendly, professional reply from the developer to the client on this ticket. 2-4 sentences, no greeting/sign-off, no markdown.",
      },
      {
        role: "user",
        content: `Ticket: ${t?.title}\n\n${t?.description ?? ""}\n\n${(comments ?? []).map((c) => c.body).join("\n---\n")}`,
      },
    ]);
    return { reply };
  });

export const autoTriageTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: t } = await supabase
      .from("tickets")
      .select("title,description,type,priority")
      .eq("id", data.ticketId)
      .maybeSingle();
    if (!t) throw new Error("Not found");
    const raw = await callAI(
      [
        {
          role: "system",
          content:
            'You triage a software support ticket. Reply with strict JSON: {"type":"bug|feature|question|feedback|change_request","priority":"low|medium|high|urgent","reasoning":"<one sentence>"}',
        },
        { role: "user", content: `Title: ${t.title}\n\nDescription: ${t.description ?? ""}` },
      ],
      { json: true },
    );
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    const allowedType = ["bug", "feature", "question", "feedback", "change_request"];
    const allowedPrio = ["low", "medium", "high", "urgent"];
    const type = allowedType.includes(parsed.type) ? parsed.type : t.type;
    const priority = allowedPrio.includes(parsed.priority) ? parsed.priority : t.priority;
    await supabase
      .from("tickets")
      .update({
        ai_suggested_type: type,
        ai_suggested_priority: priority,
        ai_summary: parsed.reasoning ?? null,
      })
      .eq("id", data.ticketId);
    return { type, priority, reasoning: parsed.reasoning ?? "" };
  });

export const analyzeScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ ticketId: z.string().uuid(), attachmentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: att } = await supabase
      .from("ticket_attachments")
      .select("storage_bucket,storage_path,mime_type")
      .eq("id", data.attachmentId)
      .maybeSingle();
    if (!att) throw new Error("Attachment not found");
    if (!att.mime_type?.startsWith("image/")) throw new Error("Not an image");
    const { data: signed } = await supabase.storage
      .from(att.storage_bucket)
      .createSignedUrl(att.storage_path, 60 * 5);
    if (!signed?.signedUrl) throw new Error("Sign failed");
    const fetched = await fetch(signed.signedUrl);
    const buf = await fetched.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const dataUrl = `data:${att.mime_type};base64,${b64}`;
    const analysis = await callAI([
      {
        role: "system",
        content:
          "You analyze a screenshot from a bug report. Describe in 2-4 sentences what's visible, any errors/UI issues, and what the user might be trying to do.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this screenshot:" },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ]);
    await supabase
      .from("tickets")
      .update({ ai_screenshot_analysis: analysis })
      .eq("id", data.ticketId);
    return { analysis };
  });

export const meetingNotesToTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ meetingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: m } = await supabase
      .from("meetings")
      .select("project_id,title,notes")
      .eq("id", data.meetingId)
      .maybeSingle();
    if (!m) throw new Error("Meeting not found");
    if (!m.notes?.trim()) throw new Error("No notes to extract from");
    const raw = await callAI(
      [
        {
          role: "system",
          content:
            'Extract action items from meeting notes as strict JSON: {"summary":"<2-3 sentence recap>","items":[{"title":"<short title>","description":"<one sentence>","type":"bug|feature|question|change_request","priority":"low|medium|high"}]}',
        },
        { role: "user", content: `Meeting: ${m.title}\n\nNotes:\n${m.notes}` },
      ],
      { json: true },
    );
    let parsed: any = { items: [], summary: "" };
    try {
      parsed = JSON.parse(raw);
    } catch {}
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const created: string[] = [];
    for (const it of items) {
      const { data: ticket } = await supabase
        .from("tickets")
        .insert({
          project_id: m.project_id,
          reporter_id: userId,
          title: String(it.title ?? "Action item").slice(0, 200),
          description: it.description ?? null,
          type: ["bug", "feature", "question", "change_request"].includes(it.type)
            ? it.type
            : "feature",
          priority: ["low", "medium", "high"].includes(it.priority) ? it.priority : "medium",
        })
        .select("id")
        .single();
      if (ticket) {
        created.push(ticket.id);
        await supabase.from("meeting_action_items").insert({
          meeting_id: data.meetingId,
          ticket_id: ticket.id,
          title: it.title,
          description: it.description ?? null,
        });
      }
    }
    await supabase
      .from("meetings")
      .update({ ai_summary: parsed.summary ?? null })
      .eq("id", data.meetingId);
    return { count: created.length, summary: parsed.summary ?? "" };
  });
