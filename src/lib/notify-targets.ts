import type { Enums } from "@/integrations/supabase/types";

/**
 * Who hears about what, as plain data.
 *
 * `deliver()` in notifications.functions.ts does the writing and the emailing;
 * everything that decides *who* gets *which* notification lives here, free of
 * the database, so it can be tested on its own.
 */

export type NotificationKind = Enums<"notification_kind">;

export interface NotifyTarget {
  userId: string;
  /**
   * The workspace the notification belongs to. The workspace boundary hides a
   * row whose workspace the recipient is not in, so without this a notification
   * lands in the seeded default workspace and nobody outside it ever sees it.
   */
  workspaceId?: string | null;
  /** Who caused it, so the inbox can show their face. */
  actorId?: string | null;
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

/** The in-app row for a target. */
export function inAppRow(target: NotifyTarget) {
  return {
    user_id: target.userId,
    kind: target.kind,
    title: target.title,
    body: target.body ?? null,
    link: target.link ?? null,
    ...(target.workspaceId ? { workspace_id: target.workspaceId } : {}),
    ...(target.actorId ? { actor_id: target.actorId } : {}),
  };
}

const EXCERPT_MAX = 200;

/** One line of a comment for a notification: no markup, no runaway length. */
export function excerptOf(text: string | null | undefined, max = EXCERPT_MAX): string {
  if (!text) return "";
  const plain = text
    // Rich-text mentions read as @Name; plain-text tokens likewise.
    .replace(/<span[^>]*data-type=["']mention["'][^>]*>(.*?)<\/span>/gi, "$1")
    .replace(/@\[([^\]\n]{1,120})\]\(user:[0-9a-fA-F-]{36}\)/g, "@$1")
    .replace(/<(br|\/p|\/li)\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/**
 * A reply or a note on a ticket.
 *
 * - Everyone in the audience hears "replied", except those mentioned, who hear
 *   "mentioned you" instead (once, not twice).
 * - Someone mentioned who is not in the audience is still told.
 * - An internal note reaches nobody but the agency people mentioned in it: a
 *   client must never be emailed the text of an internal note.
 * - Nobody is notified about their own comment.
 */
export function ticketCommentTargets(input: {
  actorId: string;
  actorName: string;
  workspaceId: string;
  ticketId: string;
  label: string;
  link: string;
  excerpt: string;
  internal: boolean;
  /** Project members, reporter and assignee. */
  audience: readonly string[];
  /** Already narrowed to workspace members. */
  mentioned: readonly string[];
  /** Workspace admins: the only people an internal note may notify. */
  agencyIds: ReadonlySet<string>;
}): NotifyTarget[] {
  const { actorId, actorName: who, label } = input;
  const mentioned = new Set(input.mentioned.filter((id) => id !== actorId));
  const base = {
    workspaceId: input.workspaceId,
    actorId,
    link: input.link,
    relatedType: "ticket",
    relatedId: input.ticketId,
  };

  const mentionTarget = (userId: string): NotifyTarget => ({
    ...base,
    userId,
    kind: "mention",
    title: `${who} mentioned you${input.internal ? " in an internal note" : ""}`,
    body: input.excerpt || `On ${label}`,
    emailSubject: `${who} mentioned you on ${label}`,
    emailBody: input.excerpt || undefined,
  });

  if (input.internal) {
    return [...mentioned].filter((id) => input.agencyIds.has(id)).map(mentionTarget);
  }

  const targets: NotifyTarget[] = [];
  const seen = new Set<string>();
  for (const userId of input.audience) {
    if (userId === actorId || seen.has(userId)) continue;
    seen.add(userId);
    targets.push(
      mentioned.has(userId)
        ? mentionTarget(userId)
        : {
            ...base,
            userId,
            kind: "comment",
            title: `${who} replied`,
            body: input.excerpt || `On ${label}`,
            emailSubject: `${who} replied on ${label}`,
            emailBody: input.excerpt || undefined,
          },
    );
  }
  for (const userId of mentioned) {
    if (!seen.has(userId)) targets.push(mentionTarget(userId));
  }
  return targets;
}

/** "Maja assigned you …". Nothing when you assign yourself or clear the assignee. */
export function assignmentTarget(input: {
  actorId: string | null;
  actorName: string;
  assigneeId: string | null | undefined;
  previousAssigneeId?: string | null;
  workspaceId: string;
  /** What was assigned, e.g. "#42 Checkout fails on Safari". */
  what: string;
  link: string;
  relatedType: string;
  relatedId: string;
}): NotifyTarget | null {
  const { assigneeId } = input;
  if (!assigneeId) return null;
  if (assigneeId === input.actorId) return null;
  if (assigneeId === input.previousAssigneeId) return null;
  return {
    userId: assigneeId,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    kind: "assigned",
    title: `${input.actorName} assigned you ${input.what}`,
    body: input.what,
    link: input.link,
    emailSubject: `${input.actorName} assigned you ${input.what}`,
    relatedType: input.relatedType,
    relatedId: input.relatedId,
  };
}

/** Mentions outside a ticket thread (planner notes, agent comments). */
export function mentionTargets(input: {
  actorId: string | null;
  actorName: string;
  mentioned: readonly string[];
  workspaceId: string;
  where: string;
  link: string;
  excerpt: string;
  relatedType: string;
  relatedId: string;
}): NotifyTarget[] {
  return [...new Set(input.mentioned)]
    .filter((id) => id !== input.actorId)
    .map((userId) => ({
      userId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      kind: "mention" as const,
      title: `${input.actorName} mentioned you`,
      body: input.excerpt || `On ${input.where}`,
      link: input.link,
      emailSubject: `${input.actorName} mentioned you on ${input.where}`,
      emailBody: input.excerpt || undefined,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
    }));
}

/** The link that opens a planner task. */
export function planTaskLink(planId: string, taskId: string): string {
  return `/app/planner/${planId}?task=${taskId}`;
}
