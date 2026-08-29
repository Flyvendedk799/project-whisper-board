import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { getPaymentsProvider } from "@/lib/providers";
import type { Database } from "@/integrations/supabase/types";

/**
 * Where a card payment lands.
 *
 * Inert until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set — the
 * placeholder provider's verifyWebhook returns null for everything, so an
 * unconfigured deployment answers 501 rather than doing something surprising.
 *
 * When it is configured, a succeeded checkout writes a `payments` row and the
 * database decides whether that settles the invoice. That is deliberately the
 * same path "Mark as paid" takes, so the two can never disagree about whether
 * an invoice is paid.
 *
 * The payments table is unique on (provider, provider_ref), so Stripe's
 * at-least-once delivery is handled by the constraint rather than by hoping the
 * webhook only fires once.
 */
export const Route = createFileRoute("/api/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const payments = getPaymentsProvider();
        if (!payments.enabled) {
          return new Response("Payments are not configured.", { status: 501 });
        }

        const raw = await request.text();
        const signature = request.headers.get("stripe-signature");

        const event = await payments.verifyWebhook(raw, signature);
        if (!event) {
          return new Response("Signature could not be verified.", { status: 400 });
        }

        if (event.kind !== "checkout.session.completed" || !event.invoiceId) {
          // Acknowledged so Stripe stops retrying something we do not act on.
          return Response.json({ received: true, handled: false });
        }

        const admin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const { data: invoice } = await admin
          .from("invoices")
          .select("id, currency")
          .eq("id", event.invoiceId)
          .maybeSingle();

        if (!invoice) return Response.json({ received: true, handled: false });

        const { error } = await admin.from("payments").insert({
          invoice_id: invoice.id,
          provider: "stripe",
          provider_ref: event.providerRef ?? null,
          amount_cents: event.amountCents ?? 0,
          currency: invoice.currency,
          status: "succeeded",
        });

        // 23505 is the unique key on (provider, provider_ref): Stripe delivered
        // this one twice, which is expected and already handled.
        if (error && error.code !== "23505") {
          console.error("[stripe] could not record payment:", error.message);
          return new Response("Could not record the payment.", { status: 500 });
        }

        return Response.json({ received: true, handled: true });
      },
    },
  },
});
