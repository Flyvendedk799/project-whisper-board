import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, FileText, Plus, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import {
  createInvoice,
  createQuote,
  recordPayment,
  respondQuote,
  sendQuote,
  startInvoiceCheckout,
} from "@/lib/billing.functions";
import {
  lineItemTotal,
  outstandingCents,
  projectInvoicesQuery,
  projectQuotesQuery,
  sumLines,
} from "@/data/billing";
import { unbilledTimeQuery, formatMinutes, totalMinutes } from "@/data/time";
import { qk } from "@/data/keys";
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
} from "@/data/enums";
import { formatCents, formatDate } from "@/lib/utils-format";
import type { InvoiceWithLines, QuoteWithLines } from "@/data/types";

type Line = { description: string; unit_price_cents: number; quantity: number };

const BLANK_LINE: Line = { description: "", unit_price_cents: 0, quantity: 1 };

export function BillingTab({
  projectId,
  currency = "USD",
}: {
  projectId: string;
  currency?: string;
}) {
  const { isAdmin } = useAuth();
  const quotes = useQuery(projectQuotesQuery(projectId));
  const invoices = useQuery(projectInvoicesQuery(projectId));

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-xl">
            <FileText className="h-5 w-5" aria-hidden="true" />
            Quotes
          </h3>
          {isAdmin && <NewQuoteButton projectId={projectId} currency={currency} />}
        </div>

        <QueryState
          query={quotes}
          errorTitle="Couldn't load quotes"
          empty={
            <Card>
              <EmptyState
                icon={FileText}
                title="No quotes yet"
                description={
                  isAdmin
                    ? "Draft one here. Accepting it turns the line items into milestones."
                    : "Any quote we send you will appear here to accept or decline."
                }
              />
            </Card>
          }
        >
          {(data) => (
            <div className="space-y-2">
              {data.map((quote) => (
                <QuoteCard key={quote.id} quote={quote} projectId={projectId} canEdit={isAdmin} />
              ))}
            </div>
          )}
        </QueryState>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-xl">
            <Receipt className="h-5 w-5" aria-hidden="true" />
            Invoices
          </h3>
          {isAdmin && <NewInvoiceButton projectId={projectId} currency={currency} />}
        </div>

        <QueryState
          query={invoices}
          errorTitle="Couldn't load invoices"
          empty={
            <Card>
              <EmptyState
                icon={Receipt}
                title="No invoices yet"
                description={isAdmin ? "Raise one when a milestone lands." : "Nothing outstanding."}
              />
            </Card>
          }
        >
          {(data) => (
            <div className="space-y-2">
              {data.map((invoice) => (
                <InvoiceCard
                  key={invoice.id}
                  invoice={invoice}
                  projectId={projectId}
                  canEdit={isAdmin}
                />
              ))}
            </div>
          )}
        </QueryState>
      </section>
    </div>
  );
}

/** Shared line-item editor. Was a fixed 4-column grid that overflowed any phone. */
function LineEditor({
  lines,
  onChange,
  currency,
}: {
  lines: Line[];
  onChange: (next: Line[]) => void;
  currency: string;
}) {
  const patch = (index: number, changes: Partial<Line>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...changes } : line)));

  return (
    <div className="space-y-2">
      <Label>Line items</Label>
      {lines.map((line, index) => (
        <div
          key={index}
          className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_7rem_5rem_auto] sm:border-0 sm:p-0"
        >
          <Input
            placeholder="What it covers"
            aria-label={`Line ${index + 1} description`}
            value={line.description}
            onChange={(e) => patch(index, { description: e.target.value })}
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="Price"
            aria-label={`Line ${index + 1} unit price`}
            value={line.unit_price_cents ? line.unit_price_cents / 100 : ""}
            onChange={(e) =>
              patch(index, { unit_price_cents: Math.round(Number(e.target.value) * 100) })
            }
          />
          <Input
            type="number"
            step="0.5"
            min="0"
            placeholder="Qty"
            aria-label={`Line ${index + 1} quantity`}
            value={line.quantity}
            onChange={(e) => patch(index, { quantity: Number(e.target.value) })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove line ${index + 1}`}
            disabled={lines.length === 1}
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([...lines, { ...BLANK_LINE }])}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Add line
        </Button>
        <span className="text-sm">
          <span className="text-muted-foreground">Total:</span>{" "}
          <span className="font-medium tabular-nums">{formatCents(sumLines(lines), currency)}</span>
        </span>
      </div>
    </div>
  );
}

function NewQuoteButton({ projectId, currency }: { projectId: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ ...BLANK_LINE }]);

  const create = useServerAction(useServerFn(createQuote), {
    label: "billing.createQuote",
    success: "Quote drafted",
    invalidate: [qk.projectQuotes(projectId)],
    onSuccess: () => {
      setOpen(false);
      setLines([{ ...BLANK_LINE }]);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          New quote
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New quote</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void create.run({
              projectId,
              currency,
              title: String(form.get("title")),
              notes: String(form.get("notes")) || undefined,
              lines: lines.filter((l) => l.description.trim()),
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="q-title">Title</Label>
            <Input id="q-title" name="title" required placeholder="Phase 2 — reporting" />
          </div>
          <LineEditor lines={lines} onChange={setLines} currency={currency} />
          <div className="space-y-1.5">
            <Label htmlFor="q-notes">Notes</Label>
            <Textarea id="q-notes" name="notes" rows={2} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.busy}>
              {create.busy ? "Saving…" : "Save draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QuoteCard({
  quote,
  projectId,
  canEdit,
}: {
  quote: QuoteWithLines;
  projectId: string;
  canEdit: boolean;
}) {
  const invalidate = [
    qk.projectQuotes(projectId),
    qk.projectMilestones(projectId),
    qk.project(projectId),
    qk.projectUpdates(projectId),
  ];

  const send = useServerAction(useServerFn(sendQuote), {
    label: "billing.sendQuote",
    success: "Quote sent",
    invalidate,
  });

  const respond = useServerAction(useServerFn(respondQuote), {
    label: "billing.respondQuote",
    success: (result) =>
      result.milestonesCreated > 0
        ? `Accepted — ${result.milestonesCreated} milestones added to the plan`
        : "Thanks, that's noted",
    invalidate,
  });

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium">{quote.title}</h4>
            <StatusPill tone={QUOTE_STATUS_TONE[quote.status]}>
              {QUOTE_STATUS_LABEL[quote.status]}
            </StatusPill>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{formatDate(quote.created_at)}</p>
        </div>
        <div className="text-lg font-medium tabular-nums">
          {formatCents(quote.total_cents, quote.currency)}
        </div>
      </div>

      {quote.quote_line_items.length > 0 && (
        <ul className="space-y-0.5 text-sm text-muted-foreground">
          {quote.quote_line_items.map((line) => (
            <li key={line.id} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                {line.description}
                {line.quantity !== 1 && ` × ${line.quantity}`}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatCents(lineItemTotal(line), quote.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {quote.notes && <p className="text-sm text-muted-foreground">{quote.notes}</p>}

      <div className="flex flex-wrap gap-2">
        {canEdit && quote.status === "draft" && (
          <Button size="sm" disabled={send.busy} onClick={() => send.fire({ quoteId: quote.id })}>
            Send to client
          </Button>
        )}
        {!canEdit && quote.status === "sent" && (
          <>
            <Button
              size="sm"
              disabled={respond.busy}
              onClick={() => respond.fire({ quoteId: quote.id, accept: true })}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={respond.busy}
              onClick={() => respond.fire({ quoteId: quote.id, accept: false })}
            >
              Decline
            </Button>
          </>
        )}
        {quote.status === "accepted" && (
          <p className="text-xs text-muted-foreground">
            Accepted {quote.responded_at ? formatDate(quote.responded_at) : ""} — the line items are
            now milestones on this project.
          </p>
        )}
      </div>
    </Card>
  );
}

function NewInvoiceButton({ projectId, currency }: { projectId: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ ...BLANK_LINE }]);
  const unbilled = useQuery({ ...unbilledTimeQuery(projectId), enabled: open });

  const create = useServerAction(useServerFn(createInvoice), {
    label: "billing.createInvoice",
    success: (result) => `${result.number ?? "Invoice"} created`,
    invalidate: [qk.projectInvoices(projectId), qk.projectTime(projectId)],
    onSuccess: () => {
      setOpen(false);
      setLines([{ ...BLANK_LINE }]);
    },
  });

  const unbilledMinutes = totalMinutes(unbilled.data ?? []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          New invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void create.run({
              projectId,
              currency,
              dueDate: String(form.get("due")) || undefined,
              lines: lines.filter((l) => l.description.trim()),
              timeEntryIds: form.get("billTime") ? (unbilled.data ?? []).map((e) => e.id) : [],
            });
          }}
          className="space-y-4"
        >
          {unbilledMinutes > 0 && (
            <label className="flex items-start gap-2 rounded-md border bg-accent/30 p-3 text-sm">
              <input type="checkbox" name="billTime" className="mt-0.5" />
              <span>
                Mark <strong>{formatMinutes(unbilledMinutes)}</strong> of unbilled time as invoiced.
                Add a line item for it below.
              </span>
            </label>
          )}

          <LineEditor lines={lines} onChange={setLines} currency={currency} />

          <div className="space-y-1.5">
            <Label htmlFor="i-due">Due date</Label>
            <Input id="i-due" name="due" type="date" />
          </div>

          <p className="text-xs text-muted-foreground">
            The number is assigned automatically from this workspace&rsquo;s sequence.
          </p>

          <DialogFooter>
            <Button type="submit" disabled={create.busy}>
              {create.busy ? "Creating…" : "Create and send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceCard({
  invoice,
  projectId,
  canEdit,
}: {
  invoice: InvoiceWithLines;
  projectId: string;
  canEdit: boolean;
}) {
  const invalidate = [qk.projectInvoices(projectId), qk.projectUpdates(projectId)];
  const outstanding = outstandingCents(invoice);

  const pay = useServerAction(useServerFn(recordPayment), {
    label: "billing.recordPayment",
    success: (result) => (result.settled ? "Marked as paid" : "Part payment recorded"),
    invalidate,
  });

  const checkout = useServerAction(useServerFn(startInvoiceCheckout), {
    label: "billing.startCheckout",
    onSuccess: (result) => {
      if (result.url) window.location.href = result.url;
    },
  });

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{invoice.number}</span>
            <StatusPill tone={INVOICE_STATUS_TONE[invoice.status]}>
              {INVOICE_STATUS_LABEL[invoice.status]}
            </StatusPill>
          </div>
          {invoice.due_date && (
            <p className="mt-1 text-xs text-muted-foreground">Due {formatDate(invoice.due_date)}</p>
          )}
        </div>
        <div className="text-right">
          <div className="text-lg font-medium tabular-nums">
            {formatCents(invoice.amount_cents, invoice.currency)}
          </div>
          {outstanding > 0 && outstanding !== invoice.amount_cents && (
            <div className="text-xs text-muted-foreground tabular-nums">
              {formatCents(outstanding, invoice.currency)} outstanding
            </div>
          )}
        </div>
      </div>

      {invoice.invoice_line_items.length > 0 && (
        <ul className="space-y-0.5 text-sm text-muted-foreground">
          {invoice.invoice_line_items.map((line) => (
            <li key={line.id} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                {line.description}
                {line.quantity !== 1 && ` × ${line.quantity}`}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatCents(lineItemTotal(line), invoice.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {invoice.payments.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {invoice.payments.map((payment) => (
            <li key={payment.id}>
              {formatCents(payment.amount_cents, payment.currency)} received{" "}
              {formatDate(payment.paid_at)}
              {payment.provider !== "manual" && ` · ${payment.provider}`}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {canEdit && outstanding > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={pay.busy}
            onClick={() => pay.fire({ invoiceId: invoice.id })}
          >
            <Receipt className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Mark as paid
          </Button>
        )}
        {!canEdit && outstanding > 0 && (
          <Button
            size="sm"
            disabled={checkout.busy}
            onClick={() => checkout.fire({ invoiceId: invoice.id })}
          >
            <CreditCard className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Pay this invoice
          </Button>
        )}
        {/*
          With no card processor configured the flow is identical up to here —
          the same invoice, the same payments row, the same trigger — so say what
          actually happens rather than showing a button that goes nowhere.
        */}
        {!canEdit && checkout.error === null && !checkout.busy && outstanding > 0 && (
          <p className="w-full text-xs text-muted-foreground">
            Paying by transfer? Go ahead — we&rsquo;ll mark it received here.
          </p>
        )}
      </div>
    </Card>
  );
}
