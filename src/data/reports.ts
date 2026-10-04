import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { CLOSED_TICKET_STATUSES, type TicketStatus } from "./enums";
import { qk } from "./keys";
import type { PersonRef } from "./types";

const AT_RISK_MS = 24 * 60 * 60 * 1000;

function slaBucket(dueAt: string | null, status: TicketStatus, now: number) {
  if (CLOSED_TICKET_STATUSES.includes(status)) return "closed" as const;
  if (!dueAt) return "none" as const;
  const due = new Date(dueAt).getTime();
  if (due <= now) return "breached" as const;
  if (due - now <= AT_RISK_MS) return "at_risk" as const;
  return "ok" as const;
}

const WINDOW_DAYS = 84;

export type ReportWeek = { week: string; opened: number; closed: number };

export type ReportSnapshot = {
  weeks: ReportWeek[];
  sla: {
    breached: number;
    atRisk: number;
    ok: number;
    none: number;
    avgFirstResponseHours: number | null;
    avgResolutionHours: number | null;
  };
  workload: Array<{ userId: string; name: string; openTickets: number; minutes: number }>;
  timeByProject: Array<{
    projectId: string;
    title: string;
    minutes: number;
    billableMinutes: number;
  }>;
  billing: Array<{
    currency: string;
    outstandingCents: number;
    paidThisMonthCents: number;
    aging: { current: number; d30: number; d60: number; older: number };
  }>;
};

export type ProjectChange = {
  id: string;
  title: string;
  date: string;
  category: "Fix" | "Improvement" | "Addition" | "Change";
  source: "ticket" | "plan";
  ticketId: string | null;
  planId: string | null;
  withPlan: boolean;
  status: string;
};

export type ChangeFilters = {
  bugs: boolean;
  features: boolean;
  source: "all" | "with_plan" | "without_plan" | "plan_only";
  completedOnly: boolean;
};

/** Compiles visible tickets and finished standalone plan tasks into a change log. */
export function compileProjectChanges(
  tickets: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    updated_at: string;
    follow_up_kind: string | null;
  }>,
  linkedTasks: Array<{ ticket_id: string | null; plan_id: string; id: string }>,
  standaloneTasks: Array<{
    id: string;
    title: string;
    completed_at: string | null;
    plan_id: string;
    status: string;
  }>,
  filters: ChangeFilters,
): ProjectChange[] {
  const planByTicket = new Map(
    linkedTasks.filter((task) => task.ticket_id).map((task) => [task.ticket_id, task.plan_id]),
  );
  const ticketRows: ProjectChange[] = tickets
    .filter((ticket) => (ticket.type === "bug" ? filters.bugs : filters.features))
    .filter((ticket) => !filters.completedOnly || ticket.status === "done")
    .filter(() => filters.source !== "plan_only")
    .filter((ticket) => filters.source !== "with_plan" || planByTicket.has(ticket.id))
    .filter((ticket) => filters.source !== "without_plan" || !planByTicket.has(ticket.id))
    .map((ticket) => ({
      id: `ticket-${ticket.id}`,
      title: ticket.title,
      date: ticket.updated_at,
      category:
        ticket.follow_up_kind === "improvement"
          ? "Improvement"
          : ticket.type === "bug" || ticket.follow_up_kind === "fix"
            ? "Fix"
            : "Addition",
      source: "ticket",
      ticketId: ticket.id,
      planId: planByTicket.get(ticket.id) ?? null,
      withPlan: planByTicket.has(ticket.id),
      status: ticket.status,
    }));
  const planRows: ProjectChange[] =
    filters.source === "without_plan"
      ? []
      : standaloneTasks
          .filter((task) => task.status === "done" && task.completed_at)
          .map((task) => ({
            id: `task-${task.id}`,
            title: task.title,
            date: task.completed_at!,
            category: "Change",
            source: "plan",
            ticketId: null,
            planId: task.plan_id,
            withPlan: true,
            status: task.status,
          }));
  return [...ticketRows, ...planRows].sort((a, b) => b.date.localeCompare(a.date));
}

export function projectChangesQuery(
  workspaceId: string | null | undefined,
  projectId: string,
  from: string,
  to: string,
) {
  return queryOptions({
    queryKey: [...qk.reports(workspaceId ?? undefined), "changes", projectId, from, to] as const,
    enabled: Boolean(workspaceId && projectId && from && to),
    queryFn: async () => {
      const start = `${from}T00:00:00.000Z`;
      const end = new Date(`${to}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const endIso = end.toISOString();
      const [ticketsRes, plansRes] = await Promise.all([
        supabase
          .from("tickets")
          .select("id, title, type, status, updated_at, follow_up_kind")
          .eq("workspace_id", workspaceId!)
          .eq("project_id", projectId)
          .gte("updated_at", start)
          .lt("updated_at", endIso)
          .order("updated_at", { ascending: false })
          .limit(500),
        supabase
          .from("plans")
          .select("id")
          .eq("workspace_id", workspaceId!)
          .eq("project_id", projectId),
      ]);
      if (ticketsRes.error) throw new DataError("reports.changeTickets", ticketsRes.error);
      if (plansRes.error) throw new DataError("reports.changePlans", plansRes.error);
      const ticketIds = (ticketsRes.data ?? []).map((ticket) => ticket.id);
      const planIds = (plansRes.data ?? []).map((plan) => plan.id);
      const [linkedRes, tasksRes] = await Promise.all([
        ticketIds.length
          ? supabase.from("plan_tasks").select("id, ticket_id, plan_id").in("ticket_id", ticketIds)
          : Promise.resolve({ data: [], error: null }),
        planIds.length
          ? supabase
              .from("plan_tasks")
              .select("id, title, completed_at, plan_id, status")
              .in("plan_id", planIds)
              .is("ticket_id", null)
              .eq("status", "done")
              .gte("completed_at", start)
              .lt("completed_at", endIso)
              .limit(500)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (linkedRes.error) throw new DataError("reports.changeLinks", linkedRes.error);
      if (tasksRes.error) throw new DataError("reports.changeTasks", tasksRes.error);
      return {
        tickets: ticketsRes.data ?? [],
        linkedTasks: linkedRes.data ?? [],
        standaloneTasks: tasksRes.data ?? [],
        limited: (ticketsRes.data?.length ?? 0) === 500 || (tasksRes.data?.length ?? 0) === 500,
      };
    },
  });
}

function weekKey(iso: string): string {
  const date = new Date(iso);
  const day = date.getDay();
  const mondayOffset = (day + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function hoursBetween(start: string, end: string): number {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000);
}

export function reportsQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: qk.reports(workspaceId ?? undefined),
    enabled: Boolean(workspaceId),
    queryFn: async (): Promise<ReportSnapshot> => {
      const since = new Date();
      since.setDate(since.getDate() - WINDOW_DAYS);
      const sinceIso = since.toISOString();
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [ticketsRes, timeRes, invoicesRes, peopleRes, projectsRes] = await Promise.all([
        supabase
          .from("tickets")
          .select(
            "id, status, created_at, resolved_at, first_response_at, sla_due_at, assignee_id, project_id",
          )
          .eq("workspace_id", workspaceId!)
          .or(
            `created_at.gte."${sinceIso}",resolved_at.gte."${sinceIso}",status.not.in.(done,wont_fix)`,
          ),
        supabase
          .from("time_entries")
          .select("project_id, user_id, duration_minutes, billable, started_at")
          .eq("workspace_id", workspaceId!)
          .gte("started_at", sinceIso)
          .not("ended_at", "is", null),
        supabase
          .from("invoices")
          .select(
            "currency, amount_cents, status, due_date, payments(amount_cents, status, paid_at)",
          )
          .eq("workspace_id", workspaceId!),
        supabase.from("workspace_members").select("user_id").eq("workspace_id", workspaceId!),
        supabase.from("projects").select("id, title").eq("workspace_id", workspaceId!),
      ]);

      if (ticketsRes.error) throw new DataError("reports.tickets", ticketsRes.error);
      if (timeRes.error) throw new DataError("reports.time", timeRes.error);
      if (invoicesRes.error) throw new DataError("reports.invoices", invoicesRes.error);
      if (peopleRes.error) throw new DataError("reports.people", peopleRes.error);
      if (projectsRes.error) throw new DataError("reports.projects", projectsRes.error);

      const memberIds = (peopleRes.data ?? []).map((row) => row.user_id);
      const { data: profiles, error: profileError } = memberIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name, email, avatar_url")
            .in("id", memberIds)
            .returns<PersonRef[]>()
        : { data: [] as PersonRef[], error: null };
      if (profileError) throw new DataError("reports.profiles", profileError);
      const names = new Map(
        (profiles ?? []).map((person) => [
          person.id,
          person.full_name ?? person.email ?? "Unknown",
        ]),
      );
      const titles = new Map(
        (projectsRes.data ?? []).map((project) => [project.id, project.title]),
      );

      const weekMap = new Map<string, ReportWeek>();
      for (let i = 0; i < 12; i += 1) {
        const cursor = new Date();
        cursor.setDate(cursor.getDate() - i * 7);
        const key = weekKey(cursor.toISOString());
        weekMap.set(key, { week: key, opened: 0, closed: 0 });
      }

      const sla = { breached: 0, atRisk: 0, ok: 0, none: 0 };
      const responseSamples: number[] = [];
      const resolutionSamples: number[] = [];
      const openByUser = new Map<string, number>();

      for (const ticket of ticketsRes.data ?? []) {
        if (ticket.created_at >= sinceIso) {
          const openedBucket = weekMap.get(weekKey(ticket.created_at));
          if (openedBucket) openedBucket.opened += 1;
        }
        if (ticket.resolved_at && ticket.resolved_at >= sinceIso) {
          const closedBucket = weekMap.get(weekKey(ticket.resolved_at));
          if (closedBucket) closedBucket.closed += 1;
          resolutionSamples.push(hoursBetween(ticket.created_at, ticket.resolved_at));
        }
        if (ticket.first_response_at && ticket.created_at >= sinceIso) {
          responseSamples.push(hoursBetween(ticket.created_at, ticket.first_response_at));
        }

        const state = slaBucket(ticket.sla_due_at, ticket.status as TicketStatus, Date.now());
        if (state === "breached") sla.breached += 1;
        else if (state === "at_risk") sla.atRisk += 1;
        else if (state === "ok") sla.ok += 1;
        else if (
          state === "none" &&
          !CLOSED_TICKET_STATUSES.includes(ticket.status as TicketStatus)
        )
          sla.none += 1;

        if (ticket.assignee_id && !CLOSED_TICKET_STATUSES.includes(ticket.status as TicketStatus)) {
          openByUser.set(ticket.assignee_id, (openByUser.get(ticket.assignee_id) ?? 0) + 1);
        }
      }

      const minutesByUser = new Map<string, number>();
      const timeByProject = new Map<
        string,
        { projectId: string; title: string; minutes: number; billableMinutes: number }
      >();
      for (const entry of timeRes.data ?? []) {
        const minutes = entry.duration_minutes ?? 0;
        minutesByUser.set(entry.user_id, (minutesByUser.get(entry.user_id) ?? 0) + minutes);
        const current = timeByProject.get(entry.project_id) ?? {
          projectId: entry.project_id,
          title: titles.get(entry.project_id) ?? "Project",
          minutes: 0,
          billableMinutes: 0,
        };
        current.minutes += minutes;
        if (entry.billable) current.billableMinutes += minutes;
        timeByProject.set(entry.project_id, current);
      }

      const userIds = new Set([...openByUser.keys(), ...minutesByUser.keys()]);
      const workload = [...userIds]
        .map((userId) => ({
          userId,
          name: names.get(userId) ?? "Former member",
          openTickets: openByUser.get(userId) ?? 0,
          minutes: minutesByUser.get(userId) ?? 0,
        }))
        .sort((a, b) => b.minutes - a.minutes || b.openTickets - a.openTickets);

      const billingMap = new Map<string, ReportSnapshot["billing"][number]>();
      const now = Date.now();
      for (const invoice of invoicesRes.data ?? []) {
        const bucket = billingMap.get(invoice.currency) ?? {
          currency: invoice.currency,
          outstandingCents: 0,
          paidThisMonthCents: 0,
          aging: { current: 0, d30: 0, d60: 0, older: 0 },
        };
        const paid = (invoice.payments ?? [])
          .filter((payment) => payment.status === "succeeded")
          .reduce((total, payment) => {
            if (payment.paid_at && new Date(payment.paid_at) >= monthStart) {
              bucket.paidThisMonthCents += payment.amount_cents;
            }
            return total + payment.amount_cents;
          }, 0);
        const outstanding = Math.max(0, invoice.amount_cents - paid);
        if (invoice.status !== "void" && invoice.status !== "paid" && outstanding > 0) {
          bucket.outstandingCents += outstanding;
          const due = invoice.due_date ? new Date(invoice.due_date).getTime() : now;
          const ageDays = Math.floor((now - due) / 86_400_000);
          if (ageDays <= 0) bucket.aging.current += outstanding;
          else if (ageDays <= 30) bucket.aging.d30 += outstanding;
          else if (ageDays <= 60) bucket.aging.d60 += outstanding;
          else bucket.aging.older += outstanding;
        }
        billingMap.set(invoice.currency, bucket);
      }

      const average = (values: number[]) =>
        values.length
          ? Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * 10) / 10
          : null;

      return {
        weeks: [...weekMap.values()].sort((a, b) => a.week.localeCompare(b.week)),
        sla: {
          ...sla,
          avgFirstResponseHours: average(responseSamples),
          avgResolutionHours: average(resolutionSamples),
        },
        workload,
        timeByProject: [...timeByProject.values()].sort((a, b) => b.minutes - a.minutes),
        billing: [...billingMap.values()],
      };
    },
  });
}

/** ISO-8601 week number for a yyyy-mm-dd (or full ISO) date, as shown on the velocity axis. */
export function isoWeekNumber(iso: string): number {
  const date = new Date(iso);
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const d = new Date(utc);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/**
 * Rows to CSV text. Cells that start with a formula character are prefixed
 * with an apostrophe so a spreadsheet never executes client-controlled text.
 */
export function rowsToCsv(rows: object[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const cell = (raw: unknown) => {
    let value = raw == null ? "" : String(raw);
    if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => cell((row as Record<string, unknown>)[h])).join(",")),
  ].join("\n");
}

/** Flattens the billing snapshot (one row per currency) for CSV export. */
export function billingCsvRows(billing: ReportSnapshot["billing"]) {
  return billing.map((row) => ({
    currency: row.currency,
    outstanding: (row.outstandingCents / 100).toFixed(2),
    paid_this_month: (row.paidThisMonthCents / 100).toFixed(2),
    current: (row.aging.current / 100).toFixed(2),
    days_1_30: (row.aging.d30 / 100).toFixed(2),
    days_31_60: (row.aging.d60 / 100).toFixed(2),
    older: (row.aging.older / 100).toFixed(2),
  }));
}
