import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";
import type { InvoiceWithLines, QuoteWithLines } from "./types";

export function projectQuotesQuery(projectId: string) {
  return queryOptions({
    queryKey: qk.projectQuotes(projectId),
    queryFn: async (): Promise<QuoteWithLines[]> => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*, quote_line_items(*)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .returns<QuoteWithLines[]>();

      if (error) throw new DataError("quotes.list", error);
      // Line items come back unordered; position is the author's intent.
      return (data ?? []).map((quote) => ({
        ...quote,
        quote_line_items: [...quote.quote_line_items].sort((a, b) => a.position - b.position),
      }));
    },
  });
}

export function projectInvoicesQuery(projectId: string) {
  return queryOptions({
    queryKey: qk.projectInvoices(projectId),
    queryFn: async (): Promise<InvoiceWithLines[]> => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, invoice_line_items(*), payments(*)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .returns<InvoiceWithLines[]>();

      if (error) throw new DataError("invoices.list", error);
      return (data ?? []).map((invoice) => ({
        ...invoice,
        invoice_line_items: [...invoice.invoice_line_items].sort((a, b) => a.position - b.position),
      }));
    },
  });
}

/** What an invoice is actually owed, given whatever has been paid so far. */
export function outstandingCents(invoice: InvoiceWithLines): number {
  const paid = invoice.payments
    .filter((p) => p.status === "succeeded")
    .reduce((total, p) => total + p.amount_cents, 0);
  return Math.max(0, invoice.amount_cents - paid);
}

export function lineItemTotal(line: { quantity: number; unit_price_cents: number }): number {
  return Math.round(line.quantity * line.unit_price_cents);
}

export function sumLines(lines: Array<{ quantity: number; unit_price_cents: number }>): number {
  return lines.reduce((total, line) => total + lineItemTotal(line), 0);
}

/** Tax is stored in basis points so a 8.25% rate is exact rather than 0.0825. */
export function withTax(subtotalCents: number, taxBps: number): number {
  return subtotalCents + Math.round((subtotalCents * taxBps) / 10_000);
}
