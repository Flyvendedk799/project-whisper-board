import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const lineSchema = z.object({
  description: z.string().min(1).max(500),
  unit_price_cents: z.number().int().min(0).max(100_000_000),
  quantity: z.number().min(0).max(10_000),
});

export const createQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      projectId: z.string().uuid(),
      title: z.string().min(1).max(200),
      currency: z.string().min(3).max(3).default("USD"),
      notes: z.string().max(5000).optional(),
      lines: z.array(lineSchema).min(1).max(50),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const subtotal = data.lines.reduce((a, l) => a + Math.round(l.unit_price_cents * l.quantity), 0);
    const { data: q, error } = await supabase
      .from("quotes")
      .insert({
        project_id: data.projectId,
        title: data.title,
        currency: data.currency,
        notes: data.notes ?? null,
        subtotal_cents: subtotal,
        total_cents: subtotal,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const rows = data.lines.map((l, i) => ({
      quote_id: q.id,
      description: l.description,
      unit_price_cents: l.unit_price_cents,
      quantity: l.quantity,
      position: i,
    }));
    const { error: liErr } = await supabase.from("quote_line_items").insert(rows);
    if (liErr) throw new Error(liErr.message);
    return { id: q.id };
  });

export const sendQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ quoteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("quotes")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", data.quoteId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const respondQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ quoteId: z.string().uuid(), accept: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("quotes")
      .update({
        status: data.accept ? "accepted" : "declined",
        responded_at: new Date().toISOString(),
      })
      .eq("id", data.quoteId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      projectId: z.string().uuid(),
      milestoneId: z.string().uuid().optional(),
      amountCents: z.number().int().min(1).max(100_000_000),
      currency: z.string().min(3).max(3).default("USD"),
      dueDate: z.string().optional(),
      number: z.string().min(1).max(50),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: inv, error } = await context.supabase
      .from("invoices")
      .insert({
        project_id: data.projectId,
        milestone_id: data.milestoneId ?? null,
        amount_cents: data.amountCents,
        currency: data.currency,
        due_date: data.dueDate ?? null,
        number: data.number,
        status: "sent",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inv.id };
  });

export const markInvoicePaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ invoiceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", data.invoiceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
