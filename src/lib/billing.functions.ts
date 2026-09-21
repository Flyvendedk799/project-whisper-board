import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { guard, requireFound } from "@/lib/server-errors";
import { AppError } from "@/lib/errors";
import { getPaymentsProvider } from "@/lib/providers";

function adminClient() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const lineSchema = z.object({
  description: z.string().min(1).max(500),
  unit_price_cents: z.number().int().min(0).max(100_000_000),
  quantity: z.number().min(0).max(10_000),
});

/** Totals are computed here, never trusted from the client. */
function sumLines(lines: Array<z.infer<typeof lineSchema>>): number {
  return lines.reduce(
    (total, line) => total + Math.round(line.unit_price_cents * line.quantity),
    0,
  );
}

export const createQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        title: z.string().min(1).max(200),
        currency: z.string().length(3).default("USD"),
        notes: z.string().max(5000).optional(),
        lines: z.array(lineSchema).min(1).max(50),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("billing.createQuote", async () => {
      const { supabase } = context;
      const subtotal = sumLines(data.lines);

      const { data: quote, error } = await supabase
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
      if (error) throw error;

      const { error: lineError } = await supabase.from("quote_line_items").insert(
        data.lines.map((line, position) => ({
          quote_id: quote.id,
          description: line.description,
          unit_price_cents: line.unit_price_cents,
          quantity: line.quantity,
          position,
        })),
      );
      if (lineError) throw lineError;

      return { id: quote.id };
    }),
  );

export const sendQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ quoteId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("billing.sendQuote", async () => {
      const { supabase } = context;
      const { data: quote, error } = await supabase
        .from("quotes")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", data.quoteId)
        .select("id, title, project_id, total_cents, currency")
        .single();
      if (error) throw error;

      const { error: updateError } = await supabase.from("project_updates").insert({
        project_id: quote.project_id,
        author_id: context.userId,
        kind: "post",
        title: `Quote: ${quote.title}`,
        body: "A new quote is ready for you to review.",
        data: { quote_id: quote.id },
      });
      if (updateError) throw updateError;

      return { ok: true };
    }),
  );

/**
 * Accepting a quote turns its line items into the project's milestones.
 *
 * This is the join the app was missing: a client could accept a quote and
 * absolutely nothing happened next. Now the agreed scope becomes the plan, and
 * the plan is what drives the progress bar the client watches.
 */
export const respondQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        quoteId: z.string().uuid(),
        accept: z.boolean(),
        createMilestones: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("billing.respondQuote", async () => {
      const { supabase } = context;

      const { data: existing } = await supabase
        .from("quotes")
        .select("id, status, project_id, title, quote_line_items(description, position)")
        .eq("id", data.quoteId)
        .maybeSingle();
      const quote = requireFound(existing, "quote");

      if (quote.status !== "sent") {
        throw new AppError(
          "quote_not_open",
          quote.status === "draft"
            ? "That quote hasn't been sent yet."
            : `That quote was already ${quote.status}.`,
        );
      }

      const { error } = await supabase
        .from("quotes")
        .update({
          status: data.accept ? "accepted" : "declined",
          responded_at: new Date().toISOString(),
        })
        .eq("id", data.quoteId);
      if (error) throw error;

      let milestonesCreated = 0;
      if (data.accept && data.createMilestones) {
        const { count } = await supabase
          .from("milestones")
          .select("id", { count: "exact", head: true })
          .eq("project_id", quote.project_id);

        const lines = [...(quote.quote_line_items ?? [])].sort((a, b) => a.position - b.position);
        if (lines.length > 0) {
          const { error: milestoneError } = await supabase.from("milestones").insert(
            lines.map((line, i) => ({
              project_id: quote.project_id,
              title: line.description,
              position: (count ?? 0) + i,
            })),
          );
          if (milestoneError) throw milestoneError;
          milestonesCreated = lines.length;
        }
      }

      const { error: updateError } = await supabase.from("project_updates").insert({
        project_id: quote.project_id,
        author_id: context.userId,
        kind: "post",
        title: `Quote ${data.accept ? "accepted" : "declined"}: ${quote.title}`,
        body: data.accept
          ? milestonesCreated > 0
            ? `Work is on. ${milestonesCreated} milestones added to the plan.`
            : "Work is on."
          : null,
        data: { quote_id: quote.id },
      });
      if (updateError) throw updateError;

      return { ok: true, milestonesCreated };
    }),
  );

export const createInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        milestoneId: z.string().uuid().optional(),
        quoteId: z.string().uuid().optional(),
        currency: z.string().length(3).default("USD"),
        dueDate: z.string().optional(),
        taxBps: z.number().int().min(0).max(10_000).default(0),
        notes: z.string().max(5000).optional(),
        /** Omit `number` to let the workspace counter assign the next one. */
        number: z.string().max(50).optional(),
        lines: z.array(lineSchema).min(1).max(100),
        /** Time entries to mark as billed on this invoice. */
        timeEntryIds: z.array(z.string().uuid()).max(500).default([]),
        send: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("billing.createInvoice", async () => {
      const { supabase } = context;
      const subtotal = sumLines(data.lines);
      const total = subtotal + Math.round((subtotal * data.taxBps) / 10_000);

      const { data: invoice, error } = await supabase
        .from("invoices")
        .insert({
          project_id: data.projectId,
          milestone_id: data.milestoneId ?? null,
          quote_id: data.quoteId ?? null,
          amount_cents: total,
          subtotal_cents: subtotal,
          tax_bps: data.taxBps,
          currency: data.currency,
          due_date: data.dueDate ?? null,
          notes: data.notes ?? null,
          number: data.number ?? null,
          status: data.send ? "sent" : "draft",
          issued_at: data.send ? new Date().toISOString() : null,
        })
        .select("id, number")
        .single();
      if (error) throw error;

      const { error: lineError } = await supabase.from("invoice_line_items").insert(
        data.lines.map((line, position) => ({
          invoice_id: invoice.id,
          description: line.description,
          unit_price_cents: line.unit_price_cents,
          quantity: line.quantity,
          position,
        })),
      );
      if (lineError) throw lineError;

      if (data.timeEntryIds.length > 0) {
        const { error: timeError } = await supabase
          .from("time_entries")
          .update({ invoice_id: invoice.id })
          .in("id", data.timeEntryIds);
        if (timeError) throw timeError;
      }

      return { id: invoice.id, number: invoice.number };
    }),
  );

/**
 * Records that money arrived.
 *
 * The old version set `status = 'paid'` on the invoice directly, which left no
 * record of what was paid, when, how much, or by whom — and could not represent
 * a part payment at all. Everything now goes through `payments`, and a trigger
 * decides whether that adds up to settled. The card path lands in the same
 * table, so the two cannot disagree.
 */
export const recordPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        invoiceId: z.string().uuid(),
        /** Omit to settle whatever is still outstanding. */
        amountCents: z.number().int().min(1).max(100_000_000).optional(),
        provider: z.string().max(50).default("manual"),
        providerRef: z.string().max(200).optional(),
        paidAt: z.string().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("billing.recordPayment", async () => {
      const { supabase, userId } = context;

      const { data: existing } = await supabase
        .from("invoices")
        .select("id, amount_cents, currency, payments(amount_cents, status)")
        .eq("id", data.invoiceId)
        .maybeSingle();
      const invoice = requireFound(existing, "invoice");

      const alreadyPaid = (invoice.payments ?? [])
        .filter((p) => p.status === "succeeded")
        .reduce((total, p) => total + p.amount_cents, 0);
      const outstanding = invoice.amount_cents - alreadyPaid;

      if (outstanding <= 0) {
        throw new AppError("already_paid", "That invoice is already settled.");
      }

      const amount = data.amountCents ?? outstanding;
      if (amount > outstanding) {
        throw new AppError(
          "overpayment",
          "That's more than is outstanding on the invoice. Adjust the amount and try again.",
        );
      }

      const { error } = await supabase.from("payments").insert({
        invoice_id: data.invoiceId,
        provider: data.provider,
        provider_ref: data.providerRef ?? null,
        amount_cents: amount,
        currency: invoice.currency,
        status: "succeeded",
        recorded_by: userId,
        paid_at: data.paidAt ?? new Date().toISOString(),
      });
      if (error) throw error;

      return { ok: true, amountCents: amount, settled: amount >= outstanding };
    }),
  );

/**
 * Starts a card payment if one is configured, and says plainly that it is not
 * if it isn't — so the client sees "your provider will confirm receipt" rather
 * than a dead button.
 */
export const startInvoiceCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ invoiceId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("billing.startCheckout", async () => {
      const { supabase } = context;
      const payments = getPaymentsProvider();

      const { data: existing } = await supabase
        .from("invoices")
        .select("id, number, amount_cents, currency, project_id, projects(title)")
        .eq("id", data.invoiceId)
        .maybeSingle();
      const invoice = requireFound(existing, "invoice");

      if (!payments.enabled) {
        return { mode: "manual" as const, url: null };
      }

      const origin = process.env.SITE_URL ?? "";
      const result = await payments.createCheckout({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amountCents: invoice.amount_cents,
        currency: invoice.currency,
        description: `${invoice.number ?? "Invoice"} — ${invoice.projects?.title ?? "Project"}`,
        successUrl: `${origin}/app/projects/${invoice.project_id}?paid=1`,
        cancelUrl: `${origin}/app/projects/${invoice.project_id}`,
      });

      if (result.url) {
        const { error } = await supabase
          .from("invoices")
          .update({ payment_link: result.url })
          .eq("id", invoice.id);
        if (error) throw error;
      }

      return { mode: result.mode, url: result.url ?? null };
    }),
  );

/**
 * Builds a print-friendly HTML snapshot for a quote or invoice, stores it in
 * the documents bucket, and returns a short-lived signed URL.
 */
export const generateBillingDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        kind: z.enum(["quote", "invoice"]),
        id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("billing.generateDocument", async () => {
      const admin = adminClient();

      let projectId: string;
      let title: string;
      let html: string;
      let filename: string;

      if (data.kind === "quote") {
        const { data: quote, error } = await context.supabase
          .from("quotes")
          .select("*, quote_line_items(*)")
          .eq("id", data.id)
          .single();
        if (error) throw error;
        projectId = quote.project_id;
        title = quote.title;
        filename = `quote-${quote.id}.html`;
        html = billingHtml({
          kind: "Quote",
          title: quote.title,
          number: null,
          currency: quote.currency,
          notes: quote.notes,
          totalCents: quote.total_cents,
          lines: (quote.quote_line_items ?? []).map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPriceCents: l.unit_price_cents,
          })),
        });
      } else {
        const { data: invoice, error } = await context.supabase
          .from("invoices")
          .select("*, invoice_line_items(*)")
          .eq("id", data.id)
          .single();
        if (error) throw error;
        projectId = invoice.project_id;
        title = invoice.number ?? "Invoice";
        filename = `invoice-${invoice.id}.html`;
        html = billingHtml({
          kind: "Invoice",
          title: invoice.number ?? "Invoice",
          number: invoice.number,
          currency: invoice.currency,
          notes: invoice.notes,
          totalCents: invoice.amount_cents,
          dueDate: invoice.due_date,
          lines: (invoice.invoice_line_items ?? []).map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPriceCents: l.unit_price_cents,
          })),
        });
      }

      const path = `${context.userId}/${projectId}/${data.kind}/${filename}`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const { error: uploadError } = await admin.storage
        .from("documents")
        .upload(path, blob, { contentType: "text/html;charset=utf-8", upsert: true });
      if (uploadError) throw uploadError;

      const { data: signed, error: signError } = await admin.storage
        .from("documents")
        .createSignedUrl(path, 60 * 30);
      if (signError) throw signError;

      return { url: signed.signedUrl, path, title };
    }),
  );

function billingHtml(doc: {
  kind: string;
  title: string;
  number: string | null;
  currency: string;
  notes: string | null;
  totalCents: number;
  dueDate?: string | null;
  lines: Array<{ description: string; quantity: number; unitPriceCents: number }>;
}) {
  const money = (cents: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency: doc.currency }).format(cents / 100);
  const rows = doc.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.description)}</td><td style="text-align:right">${line.quantity}</td><td style="text-align:right">${money(line.unitPriceCents)}</td><td style="text-align:right">${money(Math.round(line.unitPriceCents * line.quantity))}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(doc.kind)} — ${escapeHtml(doc.title)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;color:#111;padding:0 16px}
  h1{font-size:24px;margin:0 0 4px} .meta{color:#666;font-size:14px;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:14px}
  th{color:#666;font-weight:600} .total{font-size:18px;font-weight:600;text-align:right;margin-top:16px}
  .notes{margin-top:24px;color:#444;white-space:pre-wrap;font-size:14px}
  @media print{body{margin:0}}
</style></head><body>
  <h1>${escapeHtml(doc.kind)}</h1>
  <div class="meta">${escapeHtml(doc.title)}${doc.number ? ` · ${escapeHtml(doc.number)}` : ""}${doc.dueDate ? ` · Due ${escapeHtml(doc.dueDate)}` : ""}</div>
  <table><thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="total">Total ${money(doc.totalCents)}</div>
  ${doc.notes ? `<div class="notes">${escapeHtml(doc.notes)}</div>` : ""}
  <script>window.onload=function(){/* ready for print */}</script>
</body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
