import type { EmailMessage, EmailProvider, EmailResult } from "./types";

/**
 * Records what would have been sent and reports it as skipped. The caller
 * persists every message to `outbound_messages` either way, so with no API key
 * the Outbox in Settings becomes a readable copy of your own notification
 * stream. Setting RESEND_API_KEY flips those rows from skipped to sent.
 */
function createOutboxEmailProvider(reason: string): EmailProvider {
  return {
    name: "outbox",
    enabled: false,
    async send(): Promise<EmailResult> {
      return { delivered: false, skippedReason: reason };
    },
  };
}

function createResendProvider(apiKey: string, from: string): EmailProvider {
  return {
    name: "resend",
    enabled: true,
    async send(message: EmailMessage): Promise<EmailResult> {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
            ...(message.replyTo ? { reply_to: message.replyTo } : {}),
            ...(message.tags
              ? { tags: Object.entries(message.tags).map(([name, value]) => ({ name, value })) }
              : {}),
          }),
        });

        if (!res.ok) {
          return { delivered: false, error: `Resend responded ${res.status}: ${await res.text()}` };
        }
        const body = (await res.json()) as { id?: string };
        return { delivered: true, providerMessageId: body.id };
      } catch (e) {
        return { delivered: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (apiKey && from) {
    cached = createResendProvider(apiKey, from);
  } else {
    cached = createOutboxEmailProvider(
      apiKey ? "EMAIL_FROM is not set" : "No email provider configured",
    );
  }
  return cached;
}

/** Test seam. */
export function resetEmailProvider() {
  cached = undefined;
}
