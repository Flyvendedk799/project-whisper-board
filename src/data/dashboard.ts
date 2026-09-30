import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";

/** Monday 00:00 local time of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export interface OutstandingByCurrency {
  currency: string;
  cents: number;
  invoices: number;
  overdue: number;
}

export interface DashboardSummary {
  outstanding: OutstandingByCurrency[];
  weekMinutes: number;
  weekBillableMinutes: number;
}

const toInt = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

/** The RPC returns jsonb, so nothing about its shape is trusted. */
export function parseDashboardSummary(raw: unknown): DashboardSummary {
  const source =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const rows = Array.isArray(source.outstanding) ? source.outstanding : [];
  const outstanding: OutstandingByCurrency[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.currency !== "string") continue;
    outstanding.push({
      currency: r.currency,
      cents: toInt(r.cents),
      invoices: toInt(r.invoices),
      overdue: toInt(r.overdue),
    });
  }
  return {
    outstanding,
    weekMinutes: toInt(source.weekMinutes),
    weekBillableMinutes: toInt(source.weekBillableMinutes),
  };
}

/** Money owed and time logged this week, aggregated in Postgres (`workspace_dashboard`). */
export function dashboardSummaryQuery(workspaceId: string | null | undefined) {
  const weekStart = startOfWeek(new Date()).toISOString();
  return queryOptions({
    queryKey: [...qk.dashboard(), "summary", workspaceId ?? "none", weekStart] as const,
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    queryFn: async (): Promise<DashboardSummary> => {
      const { data, error } = await supabase.rpc("workspace_dashboard", {
        _workspace_id: workspaceId!,
        _week_start: weekStart,
      });
      if (error) throw new DataError("dashboard.summary", error);
      return parseDashboardSummary(data);
    },
  });
}

export interface ComingUpItem {
  id: string;
  kind: "meeting" | "milestone";
  title: string;
  /** ISO timestamp for meetings, `YYYY-MM-DD` for milestones. */
  at: string;
  projectId: string;
  projectTitle: string | null;
  overdue: boolean;
}

/** Meetings and unfinished milestones, soonest first. Overdue milestones lead. */
export function mergeComingUp(items: ComingUpItem[], limit = 6): ComingUpItem[] {
  const time = (item: ComingUpItem) =>
    item.kind === "milestone"
      ? new Date(`${item.at}T23:59:59`).getTime()
      : new Date(item.at).getTime();
  return [...items].sort((a, b) => time(a) - time(b)).slice(0, limit);
}

const dayString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** What is about to happen across every project the viewer can see. */
export function comingUpQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: [...qk.dashboard(), "coming-up", workspaceId ?? "none"] as const,
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: async (): Promise<ComingUpItem[]> => {
      const today = dayString(new Date());
      const horizon = dayString(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

      const [meetings, milestones] = await Promise.all([
        supabase
          .from("meetings")
          .select("id, title, scheduled_at, project_id, project:projects(id, title)")
          .eq("workspace_id", workspaceId!)
          .eq("status", "scheduled")
          .gte("scheduled_at", new Date().toISOString())
          .order("scheduled_at")
          .limit(6),
        supabase
          .from("milestones")
          .select("id, title, due_date, project_id, project:projects(id, title)")
          .eq("workspace_id", workspaceId!)
          .neq("status", "done")
          .not("due_date", "is", null)
          .lte("due_date", horizon)
          .order("due_date")
          .limit(6),
      ]);

      if (meetings.error) throw new DataError("dashboard.meetings", meetings.error);
      if (milestones.error) throw new DataError("dashboard.milestones", milestones.error);

      const items: ComingUpItem[] = [
        ...(meetings.data ?? []).map<ComingUpItem>((m) => ({
          id: `meeting-${m.id}`,
          kind: "meeting",
          title: m.title,
          at: m.scheduled_at,
          projectId: m.project_id,
          projectTitle: (m.project as { title: string } | null)?.title ?? null,
          overdue: false,
        })),
        ...(milestones.data ?? []).flatMap<ComingUpItem>((m) =>
          m.due_date
            ? [
                {
                  id: `milestone-${m.id}`,
                  kind: "milestone",
                  title: m.title,
                  at: m.due_date,
                  projectId: m.project_id,
                  projectTitle: (m.project as { title: string } | null)?.title ?? null,
                  overdue: m.due_date < today,
                },
              ]
            : [],
        ),
      ];
      return mergeComingUp(items);
    },
  });
}
