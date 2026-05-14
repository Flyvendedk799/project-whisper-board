import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function callAI(messages: Array<{ role: string; content: string }>) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

export const summarizeTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: t } = await supabase.from("tickets").select("title,description,type,priority,status").eq("id", data.ticketId).maybeSingle();
    if (!t) throw new Error("Not found");
    const { data: comments } = await supabase.from("ticket_comments").select("body,created_at").eq("ticket_id", data.ticketId).order("created_at");
    const text = [
      `Title: ${t.title}`,
      `Type: ${t.type} · Priority: ${t.priority} · Status: ${t.status}`,
      `Description: ${t.description ?? "(none)"}`,
      "",
      "Thread:",
      ...(comments ?? []).map((c) => `- ${c.body}`),
    ].join("\n");
    const summary = await callAI([
      { role: "system", content: "You are a concise project assistant. Summarize this support ticket in 3-5 bullets: what's broken/asked, what's been tried, what's blocked. Plain text, no markdown headers." },
      { role: "user", content: text },
    ]);
    await supabase.from("ai_summaries").insert({ subject_id: data.ticketId, subject_type: "ticket", summary });
    return { summary };
  });

export const draftReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: t } = await supabase.from("tickets").select("title,description,status").eq("id", data.ticketId).maybeSingle();
    const { data: comments } = await supabase.from("ticket_comments").select("body").eq("ticket_id", data.ticketId).order("created_at");
    const reply = await callAI([
      { role: "system", content: "Draft a short, friendly, professional reply from the developer to the client on this ticket. 2-4 sentences, no greeting/sign-off, no markdown." },
      { role: "user", content: `Ticket: ${t?.title}\n\n${t?.description ?? ""}\n\n${(comments ?? []).map((c) => c.body).join("\n---\n")}` },
    ]);
    return { reply };
  });
