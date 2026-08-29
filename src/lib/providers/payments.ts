import type {
  CheckoutRequest,
  CheckoutResult,
  PaymentStatus,
  PaymentsProvider,
  WebhookEvent,
} from "./types";

/**
 * With no card processor, an invoice is settled by recording that money
 * arrived — which is what actually happens with a bank transfer anyway. The
 * `payments` row and the trigger that marks the invoice paid are identical on
 * both paths, so nothing downstream knows or cares which one was used.
 */
function createManualPaymentsProvider(): PaymentsProvider {
  return {
    name: "manual",
    enabled: false,
    async createCheckout(): Promise<CheckoutResult> {
      return { mode: "manual" };
    },
    async getPaymentStatus(): Promise<PaymentStatus> {
      return { status: "pending" };
    },
    async verifyWebhook(): Promise<WebhookEvent | null> {
      return null;
    },
  };
}

function createStripeProvider(
  secretKey: string,
  webhookSecret: string | undefined,
): PaymentsProvider {
  const api = async (path: string, body?: URLSearchParams) => {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(body ? { body } : {}),
    });
    if (!res.ok) throw new Error(`Stripe responded ${res.status}: ${await res.text()}`);
    return res.json();
  };

  return {
    name: "stripe",
    enabled: true,

    async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
      const body = new URLSearchParams({
        mode: "payment",
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": request.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(request.amountCents),
        "line_items[0][price_data][product_data][name]": request.description,
        "metadata[invoice_id]": request.invoiceId,
      });
      const session = (await api("checkout/sessions", body)) as { id: string; url: string };
      return { mode: "redirect", url: session.url, providerRef: session.id };
    },

    async getPaymentStatus(providerRef: string): Promise<PaymentStatus> {
      const session = (await api(`checkout/sessions/${providerRef}`)) as {
        payment_status: string;
        amount_total: number;
      };
      return {
        status: session.payment_status === "paid" ? "succeeded" : "pending",
        amountCents: session.amount_total,
      };
    },

    async verifyWebhook(rawBody: string, signature: string | null): Promise<WebhookEvent | null> {
      if (!webhookSecret || !signature) return null;
      if (!(await verifyStripeSignature(rawBody, signature, webhookSecret))) return null;

      const event = JSON.parse(rawBody) as {
        type: string;
        data: { object: { id: string; metadata?: { invoice_id?: string }; amount_total?: number } };
      };
      const object = event.data.object;
      return {
        kind: event.type,
        invoiceId: object.metadata?.invoice_id,
        providerRef: object.id,
        amountCents: object.amount_total,
      };
    },
  };
}

/**
 * Stripe signs `t=<timestamp>,v1=<hmac>` over `<timestamp>.<body>`. Verified
 * with WebCrypto because Cloudflare Workers has no node:crypto HMAC.
 */
async function verifyStripeSignature(
  body: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  // Reject replays of anything older than five minutes.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

let cached: PaymentsProvider | undefined;

export function getPaymentsProvider(): PaymentsProvider {
  if (cached) return cached;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  cached = secretKey
    ? createStripeProvider(secretKey, process.env.STRIPE_WEBHOOK_SECRET)
    : createManualPaymentsProvider();
  return cached;
}

/** Test seam. */
export function resetPaymentsProvider() {
  cached = undefined;
}
