import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { AppError } from "@/lib/errors";
import { guard } from "@/lib/server-errors";
import { actorName, deliver, type NotifyTarget } from "@/lib/notifications.functions";
import { excerptOf } from "@/lib/notify-targets";
import {
  CLIENT_COMMENT_MAX,
  CLIENT_SUMMARY_MAX,
  type ClientApproval,
  type ClientComment,
  type ClientPlanOverview,
  type ClientPlanView,
} from "@/lib/plan-client-view";

/**
 * The client layer of a plan: what a client of a shared plan sees and can do.
 * Everything here goes through the caller's own session, so the database decides
 * who may read or write; the agency layer is never touched.
 */

const PERSON = "id, full_name, email, avatar_url";

function adminDb() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function clientViewLink(planId: string) {
  return `/app/planner/${planId}?view=client`;
}

function toOverview(value: unknown): ClientPlanOverview {
  const overview = value as ClientPlanOverview | null;
  if (!overview || typeof overview !== "object" || !Array.isArray(overview.sections)) {
    throw new AppError("not_found", "We couldn't find that plan.", { status: 404 });
  }
  return overview;
}

/** The plan as its clients see it, with their comments and approvals. */
export const getClientPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("clientPlan.get", async (): Promise<ClientPlanView> => {
      const { supabase } = context;

      const { data: overview, error } = await supabase.rpc("plan_client_overview", {
        _plan_id: data.planId,
      });
      if (error) {
        if (/forbidden/i.test(error.message)) {
          throw new AppError("forbidden", "You don't have access to this plan.", { status: 403 });
        }
        throw error;
      }

      const [comments, approvals] = await Promise.all([
        supabase
          .from("plan_section_comments")
          .select(`id, section_id, body, created_at, author:profiles(${PERSON})`)
          .eq("plan_id", data.planId)
          .order("created_at", { ascending: true })
          .returns<ClientComment[]>(),
        supabase
          .from("plan_section_approvals")
          .select(`section_id, user_id, created_at, user:profiles(${PERSON})`)
          .eq("plan_id", data.planId)
          .order("created_at", { ascending: true })
          .returns<ClientApproval[]>(),
      ]);
      if (comments.error) throw comments.error;
      if (approvals.error) throw approvals.error;

      return {
        plan: toOverview(overview),
        comments: comments.data ?? [],
        approvals: approvals.data ?? [],
      };
    }),
  );

/** Writes the plain-language summary of a section. Anyone who can edit the plan may. */
export const setSectionClientSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        sectionId: z.string().uuid(),
        summary: z.string().max(CLIENT_SUMMARY_MAX),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("clientPlan.setSummary", async () => {
      const { error } = await context.supabase.rpc("set_section_client_summary", {
        _section_id: data.sectionId,
        _summary: data.summary,
      });
      if (error) {
        if (/forbidden/i.test(error.message)) {
          throw new AppError("forbidden", "You can't edit this plan.", { status: 403 });
        }
        if (/not found/i.test(error.message)) {
          throw new AppError("not_found", "We couldn't find that section.", { status: 404 });
        }
        throw error;
      }
      return { ok: true };
    }),
  );

/**
 * Tell the other side that a comment was posted: the agency when a client wrote
 * it, the plan's clients when the agency did. Never throws.
 */
async function notifyComment(input: {
  actorId: string;
  workspaceId: string;
  projectId: string | null;
  planId: string;
  planTitle: string;
  sectionTitle: string | null;
  body: string;
}) {
  try {
    const db = adminDb();
    const { data: members } = await db
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", input.workspaceId);
    const actorIsAgency = (members ?? []).some(
      (member) => member.user_id === input.actorId && member.role === "admin",
    );

    let recipients: string[];
    if (actorIsAgency) {
      if (!input.projectId) return;
      const { data: projectMembers } = await db
        .from("project_members")
        .select("user_id, role")
        .eq("project_id", input.projectId);
      recipients = (projectMembers ?? [])
        .filter((member) => member.role === "client" || member.role === "client_admin")
        .map((member) => member.user_id);
    } else {
      recipients = (members ?? [])
        .filter((member) => member.role === "admin")
        .map((member) => member.user_id);
    }
    recipients = [...new Set(recipients)].filter((id) => id !== input.actorId);
    if (recipients.length === 0) return;

    const who = await actorName(input.actorId);
    const where = input.sectionTitle
      ? `${input.planTitle} · ${input.sectionTitle}`
      : input.planTitle;
    const excerpt = excerptOf(input.body);
    const targets: NotifyTarget[] = recipients.map((userId) => ({
      userId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      kind: "comment",
      title: actorIsAgency
        ? `${who} har svaret på planen ${where}`
        : `${who} kommenterede ${where}`,
      body: excerpt || null,
      link: clientViewLink(input.planId),
      emailSubject: actorIsAgency
        ? `Nyt svar på planen ${input.planTitle}`
        : `${who} kommenterede planen ${input.planTitle}`,
      emailBody: excerpt || undefined,
      template: "plan_client_comment",
      relatedType: "plan",
      relatedId: input.planId,
    }));
    await deliver(targets);
  } catch (error) {
    console.error("[client-plan] comment notice failed:", error);
  }
}

/** A comment on one section, or (no section) on the plan as a whole. */
export const addPlanComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        sectionId: z.string().uuid().nullable().optional(),
        body: z.string().trim().min(1, "Write a comment first.").max(CLIENT_COMMENT_MAX),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("clientPlan.comment", async () => {
      const { supabase, userId } = context;

      const { data: plan } = await supabase
        .from("plans")
        .select("id, title, workspace_id, project_id")
        .eq("id", data.planId)
        .maybeSingle();
      if (!plan) throw new AppError("not_found", "We couldn't find that plan.", { status: 404 });

      const { data: comment, error } = await supabase
        .from("plan_section_comments")
        .insert({
          plan_id: data.planId,
          section_id: data.sectionId ?? null,
          author_id: userId,
          body: data.body,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "42501") {
          throw new AppError("forbidden", "You can't comment on this plan.", { status: 403 });
        }
        throw error;
      }

      let sectionTitle: string | null = null;
      if (data.sectionId) {
        const { data: overview } = await supabase.rpc("plan_client_overview", {
          _plan_id: data.planId,
        });
        sectionTitle =
          toOverview(overview).sections.find((section) => section.id === data.sectionId)?.title ??
          null;
      }
      await notifyComment({
        actorId: userId,
        workspaceId: plan.workspace_id,
        projectId: plan.project_id,
        planId: plan.id,
        planTitle: plan.title,
        sectionTitle,
        body: data.body,
      });

      return { id: comment.id };
    }),
  );

export const deletePlanComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ commentId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("clientPlan.deleteComment", async () => {
      const { error } = await context.supabase
        .from("plan_section_comments")
        .delete()
        .eq("id", data.commentId);
      if (error) throw error;
      return { ok: true };
    }),
  );

/** Approve a section, or take the approval back. */
export const setSectionApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        sectionId: z.string().uuid(),
        approved: z.boolean(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("clientPlan.approve", async () => {
      const { supabase, userId } = context;

      if (data.approved) {
        const { error } = await supabase.from("plan_section_approvals").upsert(
          {
            plan_id: data.planId,
            section_id: data.sectionId,
            user_id: userId,
          },
          { onConflict: "section_id,user_id", ignoreDuplicates: true },
        );
        if (error) {
          if (error.code === "42501") {
            throw new AppError("forbidden", "You can't approve this section.", { status: 403 });
          }
          throw error;
        }
      } else {
        const { error } = await supabase
          .from("plan_section_approvals")
          .delete()
          .eq("section_id", data.sectionId)
          .eq("user_id", userId);
        if (error) throw error;
      }
      return { ok: true };
    }),
  );
