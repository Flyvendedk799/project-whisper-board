import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusPill } from "@/components/app-shell";
import { Plus, Trash2, FileText, Receipt, Check } from "lucide-react";
import { toast } from "sonner";
import { formatCents } from "@/lib/utils-format";
import { createQuote, sendQuote, respondQuote, createInvoice, markInvoicePaid } from "@/lib/billing.functions";

type Line = { description: string; unit_price_cents: number; quantity: number };

export function BillingTab({ projectId, currency = "USD" }: { projectId: string; currency?: string }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const quotes = useQuery({
    queryKey: ["quotes", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("*,quote_line_items(*)").eq("project_id", projectId).order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
  const invoices = useQuery({
    queryKey: ["invoices", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quotes", projectId] });
    qc.invalidateQueries({ queryKey: ["invoices", projectId] });
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl flex items-center gap-2"><FileText className="h-5 w-5" />Quotes</h3>
          {isAdmin && <NewQuoteButton projectId={projectId} currency={currency} onCreated={refresh} />}
        </div>
        {(quotes.data?.length ?? 0) === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">No quotes yet.</Card>
        ) : (
          <div className="space-y-2">
            {quotes.data!.map((q) => <QuoteCard key={q.id} quote={q} canEdit={!!isAdmin} onChanged={refresh} />)}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl flex items-center gap-2"><Receipt className="h-5 w-5" />Invoices</h3>
          {isAdmin && <NewInvoiceButton projectId={projectId} currency={currency} onCreated={refresh} />}
        </div>
        {(invoices.data?.length ?? 0) === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">No invoices yet.</Card>
        ) : (
          <Card className="divide-y">
            {invoices.data!.map((i) => (
              <div key={i.id} className="flex items-center gap-3 p-4">
                <span className="font-mono text-xs text-muted-foreground w-24">{i.number}</span>
                <span className="flex-1">{formatCents(i.amount_cents, i.currency)}</span>
                {i.due_date && <span className="text-xs text-muted-foreground">due {i.due_date}</span>}
                <StatusPill tone={i.status === "paid" ? "success" : i.status === "overdue" ? "destructive" : "info"}>{i.status}</StatusPill>
                {isAdmin && i.status !== "paid" && <MarkPaidButton invoiceId={i.id} onDone={refresh} />}
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function NewQuoteButton({ projectId, currency, onCreated }: { projectId: string; currency: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", unit_price_cents: 0, quantity: 1 }]);
  const [busy, setBusy] = useState(false);
  const fn = useServerFn(createQuote);

  const subtotal = lines.reduce((a, l) => a + Math.round(l.unit_price_cents * l.quantity), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fn({ data: { projectId, title, currency, notes: notes || undefined, lines } });
      toast.success("Quote drafted");
      setOpen(false); setTitle(""); setNotes(""); setLines([{ description: "", unit_price_cents: 0, quantity: 1 }]);
      onCreated();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Plus className="h-4 w-4 mr-1.5" />New quote</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New quote</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Title</Label><Input required value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-2">
            <Label>Line items</Label>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_100px_80px_auto] gap-2 items-center">
                <Input placeholder="Description" value={l.description} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                <Input type="number" step="0.01" placeholder="Unit price" value={l.unit_price_cents / 100 || ""} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, unit_price_cents: Math.round(Number(e.target.value) * 100) } : x))} />
                <Input type="number" step="0.5" placeholder="Qty" value={l.quantity} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} />
                <Button type="button" variant="ghost" size="icon" onClick={() => setLines((arr) => arr.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={() => setLines((arr) => [...arr, { description: "", unit_price_cents: 0, quantity: 1 }])}><Plus className="h-4 w-4 mr-1" />Add line</Button>
          </div>
          <div><Label>Notes</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="text-right text-sm"><span className="text-muted-foreground">Total:</span> <span className="font-medium">{formatCents(subtotal, currency)}</span></div>
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Save draft"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QuoteCard({ quote, canEdit, onChanged }: { quote: any; canEdit: boolean; onChanged: () => void }) {
  const send = useServerFn(sendQuote);
  const respond = useServerFn(respondQuote);
  const [busy, setBusy] = useState(false);
  const tone =
    quote.status === "accepted" ? "success" :
    quote.status === "declined" ? "destructive" :
    quote.status === "sent" ? "info" : "default";

  async function doSend() { setBusy(true); try { await send({ data: { quoteId: quote.id } }); toast.success("Quote sent"); onChanged(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }
  async function doRespond(accept: boolean) { setBusy(true); try { await respond({ data: { quoteId: quote.id, accept } }); toast.success(accept ? "Accepted" : "Declined"); onChanged(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><h4 className="font-medium">{quote.title}</h4><StatusPill tone={tone}>{quote.status}</StatusPill></div>
          <div className="text-xs text-muted-foreground mt-1">{new Date(quote.created_at).toLocaleDateString()}</div>
        </div>
        <div className="text-lg font-medium">{formatCents(quote.total_cents, quote.currency)}</div>
      </div>
      {quote.quote_line_items?.length > 0 && (
        <div className="text-sm text-muted-foreground space-y-0.5">
          {quote.quote_line_items.sort((a: any, b: any) => a.position - b.position).map((l: any) => (
            <div key={l.id} className="flex justify-between"><span>{l.description} × {l.quantity}</span><span>{formatCents(Math.round(l.unit_price_cents * l.quantity), quote.currency)}</span></div>
          ))}
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {canEdit && quote.status === "draft" && <Button size="sm" onClick={doSend} disabled={busy}>Send to client</Button>}
        {!canEdit && quote.status === "sent" && (
          <>
            <Button size="sm" onClick={() => doRespond(true)} disabled={busy}>Accept</Button>
            <Button size="sm" variant="outline" onClick={() => doRespond(false)} disabled={busy}>Decline</Button>
          </>
        )}
      </div>
    </Card>
  );
}

function NewInvoiceButton({ projectId, currency, onCreated }: { projectId: string; currency: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const fn = useServerFn(createInvoice);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fn({ data: { projectId, number, amountCents: Math.round(Number(amount) * 100), currency, dueDate: dueDate || undefined } });
      toast.success("Invoice created");
      setOpen(false); setNumber(""); setAmount(""); setDueDate("");
      onCreated();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Plus className="h-4 w-4 mr-1.5" />New invoice</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New invoice</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Number</Label><Input required value={number} onChange={(e) => setNumber(e.target.value)} placeholder="INV-001" /></div>
            <div><Label>Amount</Label><Input required type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          </div>
          <div><Label>Due date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MarkPaidButton({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const fn = useServerFn(markInvoicePaid);
  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await fn({ data: { invoiceId } }); toast.success("Marked paid"); onDone(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
    }}><Check className="h-4 w-4 mr-1" />Mark paid</Button>
  );
}
