/**
 * Third-party services, behind interfaces.
 *
 * Every one of these has a real implementation and a placeholder, chosen from
 * the environment at call time. The placeholders are deliberately not no-ops:
 * email that cannot be sent is still composed, addressed and recorded where you
 * can read it; an invoice with no card processor is still settled through the
 * same payments table and the same trigger; an error with nowhere to be
 * reported is still captured with a fingerprint.
 *
 * The consequence is that the whole application is exercisable with no keys
 * configured, and adding a key later changes which adapter answers — not any
 * calling code.
 */

export interface Provider {
  readonly name: string;
  /** False when running on the placeholder. UI may use this to hide features. */
  readonly enabled: boolean;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  tags?: Record<string, string>;
}

export interface EmailResult {
  delivered: boolean;
  providerMessageId?: string;
  /** Set when nothing was sent on purpose, e.g. no API key configured. */
  skippedReason?: string;
  error?: string;
}

export interface EmailProvider extends Provider {
  send(message: EmailMessage): Promise<EmailResult>;
}

export interface CheckoutRequest {
  invoiceId: string;
  invoiceNumber: string | null;
  amountCents: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  /** `redirect` hands the payer a URL; `manual` means someone records payment. */
  mode: "redirect" | "manual";
  url?: string;
  providerRef?: string;
}

export interface PaymentStatus {
  status: "pending" | "succeeded" | "failed";
  amountCents?: number;
  paidAt?: string;
}

export interface WebhookEvent {
  kind: string;
  invoiceId?: string;
  providerRef?: string;
  amountCents?: number;
}

export interface PaymentsProvider extends Provider {
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  getPaymentStatus(providerRef: string): Promise<PaymentStatus>;
  /** Returns null when the signature does not verify. */
  verifyWebhook(rawBody: string, signature: string | null): Promise<WebhookEvent | null>;
}

export interface ErrorTracker extends Provider {
  /** Fire and forget. Must never throw — reporting a failure cannot be a failure. */
  capture(error: unknown, context?: Record<string, unknown>): void;
  setUser(user: { id: string; email?: string } | null): void;
}

export type AiRole = "system" | "user" | "assistant";

export type AiContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export interface AiMessage {
  role: AiRole;
  content: AiContent;
}

export interface AiProvider extends Provider {
  readonly model: string;
  chat(messages: AiMessage[], opts?: { json?: boolean; maxTokens?: number }): Promise<string>;
}
