import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard } from "@/lib/server-errors";
import { getEmailProvider } from "@/lib/providers/server";
import { appUrl } from "@/lib/app-origin";
import { channelEnabled } from "@/data/notifications";
import type { Database } from "@/integrations/supabase/types";
import { extractMentionIds } from "@/lib/mentions";
import {
  AGENCY_ROLES,
  assignmentTarget,
  excerptOf,
  inAppRow,
  mentionTargets,
  ticketCommentTargets,
  type NotifyTarget,
} from "@/lib/notify-targets";

export type { NotifyTarget } from "@/lib/notify-targets";

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

/** Service role: notifying somebody means writing a row they own. */
function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Absolute link for an email; a bare path only if no origin is known at all. */
function siteUrl(path: string): string {
  try {
    return appUrl(path);
  } catch {
    return path;
  }
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

type InAppRow = ReturnType<typeof inAppRow>;

/**
 * Insert the in-app rows, tolerating a database a migration behind.
 *
 * The app and its migrations deploy separately, so for a few minutes after a
 * release the `actor_id` column or the `assigned` kind may not exist yet. Losing
 * the notification over that would be silly: retry without the new parts.
 */
async function insertNotifications(db: ReturnType<typeof admin>, rows: InAppRow[]) {
  const { error } = await db.from("notifications").insert(rows);
  if (!error) return null;
  const message = `${error.code ?? ""} ${error.message ?? ""}`;
  const missingActor = /actor_id/.test(message);
  const missingKind = /notification_kind|assigned/.test(message);
  if (!missingActor && !missingKind) return error;
  const fallback = rows.map(({ actor_id: _actor, ...row }: InAppRow & { actor_id?: string }) => ({
    ...row,
    kind: missingKind && row.kind === "assigned" ? ("ticket_update" as const) : row.kind,
  }));
  const retry = await db.from("notifications").insert(fallback);
  return retry.error;
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
    .map(inAppRow);

  if (inAppRows.length > 0) {
    const error = await insertNotifications(db, inAppRows);
    if (error) console.error("[notifications] in-app insert failed:", error.message);
  }

  const email = await getEmailProvider();
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

    const delivered = await sendAndRecord(db, email, {
      to: profile.email,
      toUserId: target.userId,
      subject: target.emailSubject,
      text,
      template: target.template ?? target.kind,
      relatedType: target.relatedType,
      relatedId: target.relatedId,
      workspaceId: target.workspaceId,
      skippedReason: quiet ? "Quiet hours" : undefined,
    });
    if (delivered) emails += 1;
  }

  return { inApp: inAppRows.length, emails };
}

export interface AccountEmail {
  to: string;
  toUserId?: string | null;
  subject: string;
  text: string;
  html?: string;
  template: string;
  relatedType?: string;
  relatedId?: string;
  workspaceId?: string | null;
}

/**
 * Sends one email through the configured provider and records it in
 * `outbound_messages` (the Outbox), sent or not. Returns whether it was sent.
 * Never throws for a provider failure: that is recorded on the row instead.
 */
async function sendAndRecord(
  db: ReturnType<typeof admin>,
  email: Awaited<ReturnType<typeof getEmailProvider>>,
  message: AccountEmail & { skippedReason?: string },
): Promise<boolean> {
  const result = message.skippedReason
    ? { delivered: false, skippedReason: message.skippedReason, error: undefined }
    : await email.send({
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });

  const { error } = await db.from("outbound_messages").insert({
    channel: "email",
    template: message.template,
    to_address: message.to,
    to_user_id: message.toUserId ?? null,
    subject: message.subject,
    body_text: message.text,
    body_html: message.html ?? null,
    status: result.delivered ? "sent" : result.skippedReason ? "skipped" : "failed",
    provider: email.name,
    provider_message_id: "providerMessageId" in result ? (result.providerMessageId ?? null) : null,
    error: result.error ?? result.skippedReason ?? null,
    related_type: message.relatedType ?? null,
    related_id: message.relatedId ?? null,
    ...(message.workspaceId ? { workspace_id: message.workspaceId } : {}),
    sent_at: result.delivered ? new Date().toISOString() : null,
  });
  if (error) console.error("[notifications] outbox insert failed:", error.message);
  return result.delivered;
}

/**
 * Account mail the person needs regardless of their notification settings
 * (e.g. an invitation), so preferences and quiet hours do not apply. Same
 * provider and Outbox as notifications; no in-app row.
 */
export async function sendAccountEmail(message: AccountEmail): Promise<boolean> {
  return sendAndRecord(admin(), await getEmailProvider(), message);
}

/** Everyone who should hear about activity on a ticket, minus whoever caused it. */
async function ticketAudience(ticketId: string, actorId: string) {
  const db = admin();

  const { data: ticket } = await db
    .from("tickets")
    .select(
      "id, ticket_number, title, project_id, workspace_id, reporter_id, assignee_id, projects(title)",
    )
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

export async function actorName(userId: string | null | undefined): Promise<string> {
  if (!userId) return "Someone";
  const { data } = await admin()
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();
  return data?.full_name || data?.email || "Someone";
}

/**
 * The members of a workspace among `ids`, with their roles.
 *
 * Every mention and every assignment is checked against this before anyone is
 * notified: a user id typed into a comment by hand, or sent by an agent, must
 * not become a way to email a stranger.
 */
export async function workspaceMemberRoles(
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const { data, error } = await admin()
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .in("user_id", unique);
  if (error) {
    console.error("[notifications] membership lookup failed:", error.message);
    return new Map();
  }
  return new Map((data ?? []).map((row) => [row.user_id, row.role as string]));
}

/**
 * Tell someone they were assigned a ticket or a task. Never throws: an
 * assignment that saved must not fail because an email could not be sent.
 */
export async function notifyAssignment(input: {
  actorId: string | null;
  /** Shown instead of the actor's profile name, e.g. an agent's name. */
  actorLabel?: string;
  assigneeId: string | null | undefined;
  previousAssigneeId?: string | null;
  workspaceId: string | null | undefined;
  what: string;
  link: string;
  relatedType: string;
  relatedId: string;
}): Promise<void> {
  try {
    if (!input.assigneeId || !input.workspaceId) return;
    if (input.assigneeId === input.actorId) return;
    if (input.assigneeId === input.previousAssigneeId) return;
    const members = await workspaceMemberRoles(input.workspaceId, [input.assigneeId]);
    if (!members.has(input.assigneeId)) return;
    const target = assignmentTarget({
      ...input,
      workspaceId: input.workspaceId,
      actorName: input.actorLabel ?? (await actorName(input.actorId)),
    });
    if (target) await deliver([target]);
  } catch (error) {
    console.error("[notifications] assignment notice failed:", error);
  }
}

/**
 * The people @mentioned in `text` (plus any picked ids) who are members of the
 * workspace. Anything else, a typo'd id or a stranger, is dropped silently.
 */
export async function resolveMentions(
  workspaceId: string | null | undefined,
  text: string,
  extraIds: readonly string[] = [],
): Promise<string[]> {
  if (!workspaceId) return [];
  const ids = [...new Set([...extractMentionIds(text), ...extraIds.map((id) => id.toLowerCase())])];
  if (ids.length === 0) return [];
  const members = await workspaceMemberRoles(workspaceId, ids);
  return ids.filter((id) => members.has(id));
}

/**
 * Tell the people @mentioned in a planner note or an agent's comment. Takes ids
 * already narrowed by `resolveMentions`. Never throws.
 */
export async function notifyMentions(input: {
  actorId: string | null;
  /** Shown instead of the actor's profile name, e.g. an agent's name. */
  actorLabel?: string;
  mentioned: readonly string[];
  text: string;
  workspaceId: string | null | undefined;
  where: string;
  link: string;
  relatedType: string;
  relatedId: string;
}): Promise<void> {
  try {
    if (!input.workspaceId || input.mentioned.length === 0) return;
    await deliver(
      mentionTargets({
        actorId: input.actorId,
        actorName: input.actorLabel ?? (await actorName(input.actorId)),
        mentioned: input.mentioned,
        workspaceId: input.workspaceId,
        where: input.where,
        link: input.link,
        excerpt: excerptOf(input.text),
        relatedType: input.relatedType,
        relatedId: input.relatedId,
      }),
    );
  } catch (error) {
    console.error("[notifications] mention notice failed:", error);
  }
}

export const notifyTicketComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ticketId: z.string().uuid(),
        /**
         * The comment just posted. When given, its text is read back (as the
         * caller, so RLS applies) and the mentions and excerpt come from it
         * rather than from what the browser claims.
         */
        commentId: z.string().uuid().optional(),
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

      let body: string | null = null;
      let internal = false;
      if (data.commentId) {
        const { data: comment } = await context.supabase
          .from("ticket_comments")
          .select("body, is_internal, author_id, ticket_id")
          .eq("id", data.commentId)
          .maybeSingle();
        // Only your own comment on this ticket can be announced.
        if (!comment || comment.author_id !== context.userId || comment.ticket_id !== ticket.id) {
          return { inApp: 0, emails: 0 };
        }
        body = comment.body;
        internal = Boolean(comment.is_internal);
      }

      const claimed = [...data.mentions, ...(body ? extractMentionIds(body) : [])];
      const members = await workspaceMemberRoles(ticket.workspace_id, [
        ...claimed,
        ...recipients,
        context.userId,
      ]);
      const agencyIds = new Set(
        [...members].filter(([, role]) => AGENCY_ROLES.has(role)).map(([id]) => id),
      );

      return deliver(
        ticketCommentTargets({
          actorId: context.userId,
          actorName: await actorName(context.userId),
          workspaceId: ticket.workspace_id,
          ticketId: ticket.id,
          label: `#${ticket.ticket_number} ${ticket.title}`,
          link: `/app/tickets/${ticket.id}`,
          excerpt: excerptOf(body ?? data.excerpt),
          internal,
          audience: recipients,
          mentioned: claimed.filter((id) => members.has(id)),
          agencyIds,
          actorIsAgency: AGENCY_ROLES.has(members.get(context.userId) ?? ""),
        }),
      );
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
          workspaceId: ticket.workspace_id,
          actorId: context.userId,
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
      // A new row would otherwise land in the default workspace, which the
      // workspace boundary refuses for anyone who is not a member of it.
      const [{ data: existing }, { data: membership }] = await Promise.all([
        context.supabase
          .from("notification_preferences")
          .select("workspace_id")
          .eq("user_id", context.userId)
          .maybeSingle(),
        context.supabase
          .from("workspace_members")
          .select("workspace_id")
          .eq("user_id", context.userId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      const workspaceId = existing?.workspace_id ?? membership?.workspace_id;
      const { error } = await context.supabase.from("notification_preferences").upsert(
        {
          user_id: context.userId,
          ...(workspaceId ? { workspace_id: workspaceId } : {}),
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

export const __testing = { isQuietHour, insertNotifications };
