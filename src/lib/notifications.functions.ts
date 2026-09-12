import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard } from "@/lib/server-errors";
import { getEmailProvider } from "@/lib/providers/server";
import { channelEnabled } from "@/data/notifications";
import type { Database } from "@/integrations/supabase/types";
import type { Enums } from "@/integrations/supabase/types";

/**
 * Notifying people, in app and by email.
 *
 * Only one kind of notification was ever sent — a reply on a ticket — even
 * though the enum has covered mentions, ticket updates, milestones, invoices
 * and meetings from the start. All six now fire, each one checked against the
 * recipient's preferences and their quiet hours.
 *
 * Email goes through the provider adapter, and every message is written to
 * `outbound_messages` whether or not it was actually sent. With no API key
 * configured that table is the Outbox screen: you can read exactly what your
 * clients would have received before you buy a domain.
 */

type NotificationKind = Enums<"notification_kind">;

/** Service role: notifying somebody means writing a row they own. */
function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function siteUrl(path: string): string {
  const origin = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  return origin ? `${origin}${path}` : path;
}

/** Local hour for the recipient, so 3am in their timezone is not 3am in ours. */
function isQuietHour(
  timezone: string,
  start: number | null,
  end: number | null,
  now = new Date(),
): boolean {
  if (start == null || end == null || start === end) return false;
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "numeric",
        hour12: false,
        timeZone: timezone,
      }).format(now),
    );
  } catch {
    return false; // An unknown timezone should not silence someone entirely.
  }
  // A window like 22 → 7 wraps past midnight.
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export interface NotifyTarget {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Subject line. Omit to skip email for this notification entirely. */
  emailSubject?: string;
  emailBody?: string;
  template?: string;
  relatedType?: string;
  relatedId?: string;
}

/**
 * Shared by every notifying path. Writes the in-app rows, then sends or records
 * the emails. A failure to email must never lose the in-app notification, so
 * the two are not in one transaction and email failures are recorded, not raised.
 */
export async function deliver(targets: NotifyTarget[]): Promise<{ inApp: number; emails: number }> {
  if (targets.length === 0) return { inApp: 0, emails: 0 };
  const db = admin();

  const userIds = [...new Set(targets.map((t) => t.userId))];

  const [{ data: prefs }, { data: profiles }] = await Promise.all([
    db.from("notification_preferences").select("*").in("user_id", userIds),
    db.from("profiles").select("id, email, full_name").in("id", userIds),
  ]);

  const prefsById = new Map((prefs ?? []).map((p) => [p.user_id, p]));
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const inAppRows = targets
    .filter((t) => channelEnabled(prefsById.get(t.userId) ?? null, t.kind, "in_app"))
    .map((t) => ({
      user_id: t.userId,
      kind: t.kind,
      title: t.title,
      body: t.body ?? null,
      link: t.link ?? null,
    }));

  if (inAppRows.length > 0) {
    const { error } = await db.from("notifications").insert(inAppRows);
    if (error) console.error("[notifications] in-app insert failed:", error.message);
  }

  const email = getEmailProvider();
  let emails = 0;

  for (const target of targets) {
    if (!target.emailSubject) continue;

    const pref = prefsById.get(target.userId) ?? null;
    if (!channelEnabled(pref, target.kind, "email")) continue;

    const profile = profileById.get(target.userId);
    if (!profile?.email) continue;

    // A mention is worth waking someone for; a status change is not.
    const quiet =
      target.kind !== "mention" &&
      isQuietHour(
        pref?.timezone ?? "UTC",
        pref?.quiet_hours_start ?? null,
        pref?.quiet_hours_end ?? null,
      );

    const text = [
      target.emailBody ?? target.body ?? target.title,
      "",
      target.link ? siteUrl(target.link) : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = quiet
      ? { delivered: false, skippedReason: "Quiet hours" as string | undefined, error: undefined }
      : await email.send({ to: profile.email, subject: target.emailSubject, text });

    const { error } = await db.from("outbound_messages").insert({
      channel: "email",
      template: target.template ?? target.kind,
      to_address: profile.email,
      to_user_id: target.userId,
      subject: target.emailSubject,
      body_text: text,
      status: result.delivered ? "sent" : result.skippedReason ? "skipped" : "failed",
      provider: email.name,
      provider_message_id:
        "providerMessageId" in result ? (result.providerMessageId ?? null) : null,
      error: result.error ?? result.skippedReason ?? null,
      related_type: target.relatedType ?? null,
      related_id: target.relatedId ?? null,
      sent_at: result.delivered ? new Date().toISOString() : null,
    });
    if (error) console.error("[notifications] outbox insert failed:", error.message);
    if (result.delivered) emails += 1;
  }

  return { inApp: inAppRows.length, emails };
}

/** Everyone who should hear about activity on a ticket, minus whoever caused it. */
async function ticketAudience(ticketId: string, actorId: string) {
  const db = admin();

  const { data: ticket } = await db
    .from("tickets")
    .select("id, ticket_number, title, project_id, reporter_id, assignee_id, projects(title)")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return null;

  const { data: members } = await db
    .from("project_members")
    .select("user_id")
    .eq("project_id", ticket.project_id);

  const recipients = new Set<string>();
  members?.forEach((m) => recipients.add(m.user_id));
  if (ticket.reporter_id) recipients.add(ticket.reporter_id);
  if (ticket.assignee_id) recipients.add(ticket.assignee_id);
  recipients.delete(actorId);

  return { ticket, recipients: [...recipients] };
}

async function actorName(userId: string): Promise<string> {
  const { data } = await admin()
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();
  return data?.full_name || data?.email || "Someone";
}

export const notifyTicketComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ticketId: z.string().uuid(),
        excerpt: z.string().max(500).optional(),
        mentions: z.array(z.string().uuid()).max(20).default([]),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("notify.comment", async () => {
      const audience = await ticketAudience(data.ticketId, context.userId);
      if (!audience) return { ok: false };

      const { ticket, recipients } = audience;
      const who = await actorName(context.userId);
      const link = `/app/tickets/${ticket.id}`;
      const label = `#${ticket.ticket_number} ${ticket.title}`;
      const mentioned = new Set(data.mentions.filter((id) => id !== context.userId));

      const targets: NotifyTarget[] = recipients.map((userId) => {
        const isMention = mentioned.has(userId);
        return {
          userId,
          kind: isMention ? "mention" : "comment",
          title: isMention ? `${who} mentioned you` : `${who} replied`,
          body: data.excerpt ? `${data.excerpt}` : `On ${label}`,
          link,
          emailSubject: isMention
            ? `${who} mentioned you on ${label}`
            : `${who} replied on ${label}`,
          emailBody: data.excerpt,
          relatedType: "ticket",
          relatedId: ticket.id,
        };
      });

      // Someone mentioned who is not on the project still gets told.
      for (const userId of mentioned) {
        if (!recipients.includes(userId)) {
          targets.push({
            userId,
            kind: "mention",
            title: `${who} mentioned you`,
            body: `On ${label}`,
            link,
            emailSubject: `${who} mentioned you on ${label}`,
            relatedType: "ticket",
            relatedId: ticket.id,
          });
        }
      }

      return deliver(targets);
    }),
  );

export const notifyTicketChanged = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ticketId: z.string().uuid(),
        summary: z.string().max(300),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("notify.ticketChanged", async () => {
      const audience = await ticketAudience(data.ticketId, context.userId);
      if (!audience) return { ok: false };

      const { ticket, recipients } = audience;
      const who = await actorName(context.userId);
      const label = `#${ticket.ticket_number} ${ticket.title}`;

      return deliver(
        recipients.map((userId) => ({
          userId,
          kind: "ticket_update" as const,
          title: `${who} ${data.summary}`,
          body: label,
          link: `/app/tickets/${ticket.id}`,
          emailSubject: `${label} — ${data.summary}`,
          relatedType: "ticket",
          relatedId: ticket.id,
        })),
      );
    }),
  );

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ ids: z.array(z.string().uuid()).max(200).optional() }).parse(input),
  )
  .handler(({ data, context }) =>
    guard("notify.markRead", async () => {
      const { supabase, userId } = context;
      const query = supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("read_at", null);

      const { error } = data.ids?.length ? await query.in("id", data.ids) : await query;
      if (error) throw error;
      return { ok: true };
    }),
  );

export const saveNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        channels: z.record(z.object({ in_app: z.boolean(), email: z.boolean() })),
        digestFrequency: z.enum(["off", "daily", "weekly"]),
        quietHoursStart: z.number().int().min(0).max(23).nullable(),
        quietHoursEnd: z.number().int().min(0).max(23).nullable(),
        timezone: z.string().max(100),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("notify.savePreferences", async () => {
      const { error } = await context.supabase.from("notification_preferences").upsert(
        {
          user_id: context.userId,
          channels: data.channels as never,
          digest_frequency: data.digestFrequency,
          quiet_hours_start: data.quietHoursStart,
          quiet_hours_end: data.quietHoursEnd,
          timezone: data.timezone,
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      return { ok: true };
    }),
  );

export const __testing = { isQuietHour };
