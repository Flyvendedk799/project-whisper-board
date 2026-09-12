import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { EmailMessage, EmailProvider, EmailResult } from "./types";

/**
 * Email over the host's own SMTP relay.
 *
 * The credentials are the ones the platform already injects for this app —
 * `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`,
 * `SMTP_FROM_NAME` — the same relay and the same sender address the auth service
 * uses for password resets. So app notifications and account mail come from one
 * place, and there is no third-party email service in the path.
 *
 * SERVER ONLY. `nodemailer` reaches for `node:tls`, which is why this module is
 * exported from `providers/server.ts` and deliberately *not* from
 * `providers/index.ts` — that barrel is imported by browser components, and a
 * node-only import reaching the client bundle is a build failure.
 */

/**
 * Records what would have been sent and reports it as skipped. The caller
 * persists every message to `outbound_messages` either way, so with no relay
 * configured the Outbox in Settings becomes a readable copy of your own
 * notification stream. Configuring SMTP flips those rows from skipped to sent.
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

function createSmtpProvider(transport: Transporter, from: string): EmailProvider {
  return {
    name: "smtp",
    enabled: true,
    async send(message: EmailMessage): Promise<EmailResult> {
      try {
        const info = await transport.sendMail({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          // Tags have no SMTP equivalent, so they ride as headers where a relay
          // log or a mail client can still surface them.
          ...(message.tags
            ? {
                headers: Object.fromEntries(
                  Object.entries(message.tags).map(([k, v]) => [`X-Tag-${k}`, v]),
                ),
              }
            : {}),
        });
        return { delivered: true, providerMessageId: info.messageId };
      } catch (e) {
        return { delivered: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

/** `Name <addr>` when a display name is configured, a bare address otherwise. */
function senderAddress(): string | undefined {
  const address = process.env.SMTP_FROM ?? process.env.EMAIL_FROM;
  if (!address) return undefined;
  // EMAIL_FROM was historically allowed to carry its own display name.
  if (address.includes("<")) return address;
  const name = process.env.SMTP_FROM_NAME;
  return name ? `${name} <${address}>` : address;
}

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;

  const host = process.env.SMTP_HOST;
  const from = senderAddress();

  if (!host) {
    cached = createOutboxEmailProvider("No email provider configured");
    return cached;
  }
  if (!from) {
    cached = createOutboxEmailProvider("SMTP_FROM is not set");
    return cached;
  }

  const port = Number(process.env.SMTP_PORT ?? "465") || 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  cached = createSmtpProvider(
    nodemailer.createTransport({
      host,
      port,
      // 465 is implicit TLS; everything else negotiates STARTTLS.
      secure: port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
    }),
    from,
  );
  return cached;
}

/** Test seam. */
export function resetEmailProvider() {
  cached = undefined;
}
