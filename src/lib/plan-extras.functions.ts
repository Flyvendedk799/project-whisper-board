import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard, requireFound } from "@/lib/server-errors";
import { AppError } from "@/lib/errors";
import {
  FEATURE_TEXT_MAX,
  parseFeatureList,
  QUESTION_ANSWER_MAX,
  QUESTION_BODY_MAX,
} from "@/lib/plan-fields";
import { MAX_STEP_DEPTH, STEP_TEXT_MAX } from "@/lib/plan-markdown";
import type { Database } from "@/integrations/supabase/types";
import { notifyClientQuestion } from "@/lib/plan-client-notify";

/**
 * Questions, feature lists and the richer sub-step operations.
 *
 * Questions are the one place where a person and an agent talk to each other
 * about a task without it being a comment: a question is asked, shows up as
 * needing an answer, and is answered (or dismissed). A blocking question holds
 * the task in "blocked"; the database trigger `plan_sync_question_block` does
 * that and puts the task back, so it behaves the same whoever asked.
 */

type Db = SupabaseClient<Database>;
type PlanEventKind = Database["public"]["Enums"]["plan_event_kind"];

async function logEvent(
  supabase: Db,
  userId: string,
  event: {
    planId: string;
    taskId: string;
    kind: PlanEventKind;
    newValue?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  },
) {
  const { error } = await supabase.from("plan_events").insert({
    plan_id: event.planId,
    task_id: event.taskId,
    actor_id: userId,
    kind: event.kind,
    new_value: event.newValue ?? null,
    metadata: event.metadata ?? {},
  });
  if (error) console.error("[planner] plan event", error.message);
}

async function taskRow(supabase: Db, taskId: string) {
  const { data } = await supabase
    .from("plan_tasks")
    .select("id, plan_id, title")
    .eq("id", taskId)
    .maybeSingle();
  return requireFound(data, "task");
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

const questionBody = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "Write the question first.")
      .max(QUESTION_BODY_MAX, `Keep the question under ${QUESTION_BODY_MAX} characters.`),
  );

export const QUESTION_AUDIENCES = ["agency", "agent", "client"] as const;
const audienceField = z.enum(QUESTION_AUDIENCES);

/** The question as the client reads it: plain Danish, required before it can go to them. */
const clientBodyField = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .max(QUESTION_BODY_MAX, `Keep the client wording under ${QUESTION_BODY_MAX} characters.`),
  );

export const askQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        taskId: z.string().uuid(),
        body: questionBody,
        /** A blocking question holds the task in "blocked" until it is answered. */
        blocking: z.boolean().optional(),
        /** Who has to answer. The agency (the person running the plan) unless said otherwise. */
        audience: audienceField.optional(),
        /** What the client reads. Required when the audience is the client. */
        clientBody: clientBodyField.optional(),
      })
      .refine((value) => value.audience !== "client" || Boolean(value.clientBody), {
        message: "Write the question for the client in Danish first.",
        path: ["clientBody"],
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("questions.ask", async () => {
      const { supabase, userId } = context;
      const task = await taskRow(supabase, data.taskId);

      const { data: question, error } = await supabase
        .from("plan_task_questions")
        .insert({
          task_id: task.id,
          body: data.body,
          blocking: data.blocking ?? false,
          asked_by_user_id: userId,
          audience: data.audience ?? "agency",
          client_body: data.clientBody || null,
        })
        .select("id")
        .single();
      if (error) throw error;

      if (data.audience === "client" && data.clientBody) {
        await notifyClientQuestion({
          actorId: userId,
          planId: task.plan_id,
          taskId: task.id,
          clientBody: data.clientBody,
        });
      }

      await logEvent(supabase, userId, {
        planId: task.plan_id,
        taskId: task.id,
        kind: "question_asked",
        newValue: data.body.slice(0, 200),
        metadata: { blocking: data.blocking ?? false, audience: data.audience ?? "agency" },
      });
      return { id: question.id };
    }),
  );

/**
 * Re-aim a question: to the agency (the default), to the agents, or to the
 * client. Sending it to the client needs the Danish wording they will read, and
 * tells them. Everything else about the question stays as it was.
 */
export const setQuestionAudience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        questionId: z.string().uuid(),
        audience: audienceField,
        clientBody: clientBodyField.optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("questions.setAudience", async () => {
      const { supabase, userId } = context;
      const { data: existing } = await supabase
        .from("plan_task_questions")
        .select("id, task_id, plan_id, client_body, audience, status")
        .eq("id", data.questionId)
        .maybeSingle();
      const question = requireFound(existing, "question");

      const clientBody = data.clientBody || question.client_body?.trim() || "";
      if (data.audience === "client" && !clientBody) {
        throw new AppError(
          "client_body_required",
          "Write the question for the client in Danish first.",
        );
      }

      const { error } = await supabase
        .from("plan_task_questions")
        .update({
          audience: data.audience,
          ...(data.clientBody ? { client_body: data.clientBody } : {}),
        })
        .eq("id", data.questionId);
      if (error) throw error;

      if (data.audience === "client" && question.audience !== "client") {
        await notifyClientQuestion({
          actorId: userId,
          planId: question.plan_id,
          taskId: question.task_id,
          clientBody,
        });
      }
      return { ok: true };
    }),
  );

export const answerQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        questionId: z.string().uuid(),
        answer: z
          .string()
          .transform((value) => value.trim())
          .pipe(z.string().min(1, "Write the answer first.").max(QUESTION_ANSWER_MAX)),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("questions.answer", async () => {
      const { supabase, userId } = context;
      const { data: updated, error } = await supabase
        .from("plan_task_questions")
        .update({
          status: "answered",
          answer: data.answer,
          answered_by_user_id: userId,
          answered_by_agent_id: null,
          answered_at: new Date().toISOString(),
        })
        .eq("id", data.questionId)
        .select("id, task_id, plan_id, body")
        .maybeSingle();
      if (error) throw error;
      const question = requireFound(updated, "question");

      await logEvent(supabase, userId, {
        planId: question.plan_id,
        taskId: question.task_id,
        kind: "question_answered",
        newValue: data.answer.slice(0, 200),
      });
      return { ok: true };
    }),
  );

/** Nobody needs to answer this any more. A blocking question stops blocking. */
export const dismissQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ questionId: z.string().uuid(), reopen: z.boolean().optional() }).parse(input),
  )
  .handler(({ data, context }) =>
    guard("questions.dismiss", async () => {
      const { supabase } = context;
      const { error } = await supabase
        .from("plan_task_questions")
        .update(
          data.reopen
            ? {
                status: "open",
                answer: null,
                answered_at: null,
                answered_by_user_id: null,
                answered_by_agent_id: null,
              }
            : { status: "dismissed" },
        )
        .eq("id", data.questionId);
      if (error) throw error;
      return { ok: true };
    }),
  );

export const setQuestionBlocking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ questionId: z.string().uuid(), blocking: z.boolean() }).parse(input),
  )
  .handler(({ data, context }) =>
    guard("questions.setBlocking", async () => {
      const { supabase } = context;
      const { error } = await supabase
        .from("plan_task_questions")
        .update({ blocking: data.blocking })
        .eq("id", data.questionId);
      if (error) throw error;
      return { ok: true };
    }),
  );

export const deleteQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ questionId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("questions.delete", async () => {
      const { supabase } = context;
      const { data: deleted, error } = await supabase
        .from("plan_task_questions")
        .delete()
        .eq("id", data.questionId)
        .select("id");
      if (error) throw error;
      if (!deleted?.length) {
        throw new AppError(
          "forbidden",
          "Only whoever asked a question or an admin can delete it.",
          {
            status: 403,
          },
        );
      }
      return { ok: true };
    }),
  );

// ---------------------------------------------------------------------------
// Feature list
// ---------------------------------------------------------------------------

const featureText = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Write the feature first.").max(FEATURE_TEXT_MAX));

/**
 * Adds features to the end of a task's list. `text` may be a pasted block of
 * bullets (numbered or not); each line becomes a feature.
 */
export const addTaskFeatures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        taskId: z.string().uuid(),
        text: z.string().max(20000).optional(),
        items: z.array(featureText).max(50).optional(),
        source: z.enum(["human", "agent", "ai"]).optional(),
      })
      .refine((value) => Boolean(value.text?.trim()) || (value.items?.length ?? 0) > 0, {
        message: "Write at least one feature.",
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("features.add", async () => {
      const { supabase } = context;
      const task = await taskRow(supabase, data.taskId);

      const parsed = [
        ...(data.text ? parseFeatureList(data.text) : []),
        ...(data.items ?? []).map((text) => ({ text, met: false })),
      ];
      if (parsed.length === 0) throw new AppError("validation", "Write at least one feature.");

      const { data: last } = await supabase
        .from("plan_task_features")
        .select("position")
        .eq("task_id", task.id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      let position = last?.position ?? 0;

      const { data: rows, error } = await supabase
        .from("plan_task_features")
        .insert(
          parsed.map((feature) => ({
            task_id: task.id,
            text: feature.text,
            met: feature.met,
            source: data.source ?? "human",
            position: ++position,
          })),
        )
        .select("id");
      if (error) throw error;
      return { created: rows?.length ?? 0, ids: (rows ?? []).map((row) => row.id) };
    }),
  );

export const updateTaskFeature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        featureId: z.string().uuid(),
        text: featureText.optional(),
        met: z.boolean().optional(),
        /** The deliverable in plain Danish; clients see a feature only when this is set. */
        clientText: z.string().max(300).nullable().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("features.update", async () => {
      const { supabase } = context;
      const patch: Database["public"]["Tables"]["plan_task_features"]["Update"] = {
        ...(data.text !== undefined && { text: data.text }),
        ...(data.met !== undefined && { met: data.met }),
        ...(data.clientText !== undefined && { client_text: data.clientText?.trim() || null }),
      };
      if (Object.keys(patch).length === 0) return { ok: true };
      const { error } = await supabase
        .from("plan_task_features")
        .update(patch)
        .eq("id", data.featureId);
      if (error) throw error;
      return { ok: true };
    }),
  );

export const deleteTaskFeature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ featureId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("features.delete", async () => {
      const { supabase } = context;
      const { error } = await supabase.from("plan_task_features").delete().eq("id", data.featureId);
      if (error) throw error;
      return { ok: true };
    }),
  );

/** Renumbers the task's features to the given order; any not named follow in their old order. */
export const reorderTaskFeatures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({ taskId: z.string().uuid(), order: z.array(z.string().uuid()).max(100) })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("features.reorder", async () => {
      const { supabase } = context;
      const { data: rows, error } = await supabase
        .from("plan_task_features")
        .select("id, position")
        .eq("task_id", data.taskId)
        .order("position", { ascending: true });
      if (error) throw error;
      const known = new Set((rows ?? []).map((row) => row.id));
      const named = data.order.filter((id) => known.has(id));
      const rest = (rows ?? []).map((row) => row.id).filter((id) => !named.includes(id));
      const current = new Map((rows ?? []).map((row) => [row.id, row.position]));
      const order = [...named, ...rest];
      for (let index = 0; index < order.length; index++) {
        if (current.get(order[index]) === index + 1) continue;
        const { error: updateError } = await supabase
          .from("plan_task_features")
          .update({ position: index + 1 })
          .eq("id", order[index])
          .eq("task_id", data.taskId);
        if (updateError) throw updateError;
      }
      return { ok: true };
    }),
  );

// ---------------------------------------------------------------------------
// Sub-steps, beyond add / tick / delete
// ---------------------------------------------------------------------------

const stepLine = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(STEP_TEXT_MAX));

/**
 * Adds several sub-steps at once, optionally all under one feature. A pasted
 * block is split by line; leading `-`, `1.` and `[ ]` markers are dropped and
 * indentation becomes depth.
 */
export const addTaskSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        taskId: z.string().uuid(),
        text: z.string().max(20000).optional(),
        items: z
          .array(
            z.object({
              text: stepLine,
              depth: z.number().int().min(0).max(MAX_STEP_DEPTH).optional(),
            }),
          )
          .max(100)
          .optional(),
        featureId: z.string().uuid().nullable().optional(),
        source: z.enum(["human", "agent", "ai"]).optional(),
      })
      .refine((value) => Boolean(value.text?.trim()) || (value.items?.length ?? 0) > 0, {
        message: "Write at least one step.",
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("steps.addMany", async () => {
      const { supabase } = context;
      const task = await taskRow(supabase, data.taskId);

      if (data.featureId) {
        const { data: feature } = await supabase
          .from("plan_task_features")
          .select("id")
          .eq("id", data.featureId)
          .eq("task_id", task.id)
          .maybeSingle();
        requireFound(feature, "feature");
      }

      const lines: Array<{ text: string; depth: number }> = [];
      for (const raw of (data.text ?? "").split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const indent = /^[ \t]*/.exec(raw)?.[0] ?? "";
        const depth = Math.min(MAX_STEP_DEPTH, Math.floor(indent.replace(/\t/g, "  ").length / 2));
        const text = raw
          .trim()
          .replace(/^(?:[-*•]+|\d+(?:\.\d+)*[.)]?)\s+/, "")
          .replace(/^\[[ xX]\]\s*/, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, STEP_TEXT_MAX);
        if (text) lines.push({ text, depth });
      }
      for (const item of data.items ?? []) lines.push({ text: item.text, depth: item.depth ?? 0 });
      if (lines.length === 0) throw new AppError("validation", "Write at least one step.");

      const { data: last } = await supabase
        .from("plan_task_steps")
        .select("position, depth")
        .eq("task_id", task.id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      let position = last?.position ?? 0;
      let previousDepth = last ? last.depth : -1;

      const { data: rows, error } = await supabase
        .from("plan_task_steps")
        .insert(
          lines.map((line) => {
            // A step is at most one level deeper than the one above it.
            const depth = Math.min(line.depth, previousDepth + 1);
            previousDepth = depth;
            return {
              task_id: task.id,
              text: line.text,
              depth,
              position: ++position,
              feature_id: data.featureId ?? null,
              source: data.source ?? "human",
            };
          }),
        )
        .select("id");
      if (error) throw error;
      return { created: rows?.length ?? 0, ids: (rows ?? []).map((row) => row.id) };
    }),
  );

/** Link a sub-step to the feature it delivers, or unlink it. */
export const setStepFeature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ stepId: z.string().uuid(), featureId: z.string().uuid().nullable() }).parse(input),
  )
  .handler(({ data, context }) =>
    guard("steps.setFeature", async () => {
      const { supabase } = context;
      const { data: step } = await supabase
        .from("plan_task_steps")
        .select("id, task_id")
        .eq("id", data.stepId)
        .maybeSingle();
      const found = requireFound(step, "step");
      if (data.featureId) {
        const { data: feature } = await supabase
          .from("plan_task_features")
          .select("id")
          .eq("id", data.featureId)
          .eq("task_id", found.task_id)
          .maybeSingle();
        requireFound(feature, "feature");
      }
      const { error } = await supabase
        .from("plan_task_steps")
        .update({ feature_id: data.featureId })
        .eq("id", data.stepId);
      if (error) throw error;
      return { ok: true };
    }),
  );

/** Renumbers a task's steps to the given order; any not named follow in their old order. */
export const reorderTaskSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({ taskId: z.string().uuid(), order: z.array(z.string().uuid()).max(200) })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("steps.reorder", async () => {
      const { supabase } = context;
      const { data: rows, error } = await supabase
        .from("plan_task_steps")
        .select("id, position, depth")
        .eq("task_id", data.taskId)
        .order("position", { ascending: true });
      if (error) throw error;
      const known = new Map((rows ?? []).map((row) => [row.id, row] as const));
      const named = data.order.filter((id) => known.has(id));
      const rest = (rows ?? []).map((row) => row.id).filter((id) => !named.includes(id));
      const order = [...named, ...rest];

      // Depth cannot jump: a step directly under another is at most one level deeper.
      let previousDepth = -1;
      for (let index = 0; index < order.length; index++) {
        const row = known.get(order[index])!;
        const depth = Math.min(row.depth, previousDepth + 1);
        previousDepth = depth;
        if (row.position === index + 1 && row.depth === depth) continue;
        const { error: updateError } = await supabase
          .from("plan_task_steps")
          .update({ position: index + 1, depth })
          .eq("id", row.id)
          .eq("task_id", data.taskId);
        if (updateError) throw updateError;
      }
      return { ok: true };
    }),
  );
