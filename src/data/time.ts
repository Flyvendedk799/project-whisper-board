import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";
import {
  PERSON_REF_COLUMNS,
  type TimeEntry,
  type TimeEntryWithRefs,
  type TimeSheetEntry,
} from "./types";

const WITH_REFS = `*, ticket:tickets(id, ticket_number, title), user:profiles(${PERSON_REF_COLUMNS})`;
const WITH_PROJECT = `${WITH_REFS}, project:projects(id, title)`;

/**
 * The timer currently running for this person, if any. The database allows at
 * most one via a partial unique index, so this is `maybeSingle` rather than a
 * list with a "pick the newest" rule that could disagree with the constraint.
 */
export function runningTimerQuery(userId: string) {
  return queryOptions({
    queryKey: qk.timer(),
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<TimeEntryWithRefs | null> => {
      const { data, error } = await supabase
        .from("time_entries")
        .select(WITH_REFS)
        .eq("user_id", userId)
        .is("ended_at", null)
        .maybeSingle()
        .returns<TimeEntryWithRefs | null>();

      if (error) throw new DataError("time_entries.running", error);
      return data;
    },
  });
}

export function ticketTimeQuery(ticketId: string) {
  return queryOptions({
    queryKey: qk.ticketTime(ticketId),
    queryFn: async (): Promise<TimeEntryWithRefs[]> => {
      const { data, error } = await supabase
        .from("time_entries")
        .select(WITH_REFS)
        .eq("ticket_id", ticketId)
        .order("started_at", { ascending: false })
        .returns<TimeEntryWithRefs[]>();

      if (error) throw new DataError("time_entries.byTicket", error);
      return data ?? [];
    },
  });
}

export function projectTimeQuery(projectId: string) {
  return queryOptions({
    queryKey: qk.projectTime(projectId),
    queryFn: async (): Promise<TimeEntryWithRefs[]> => {
      const { data, error } = await supabase
        .from("time_entries")
        .select(WITH_REFS)
        .eq("project_id", projectId)
        .order("started_at", { ascending: false })
        .limit(200)
        .returns<TimeEntryWithRefs[]>();

      if (error) throw new DataError("time_entries.byProject", error);
      return data ?? [];
    },
  });
}

/** Billable, finished, and not yet on an invoice — what a new invoice can pull in. */
export function unbilledTimeQuery(projectId: string) {
  return queryOptions({
    queryKey: [...qk.projectTime(projectId), "unbilled"] as const,
    queryFn: async (): Promise<TimeEntryWithRefs[]> => {
      const { data, error } = await supabase
        .from("time_entries")
        .select(WITH_REFS)
        .eq("project_id", projectId)
        .eq("billable", true)
        .is("invoice_id", null)
        .not("ended_at", "is", null)
        .order("started_at")
        .returns<TimeEntryWithRefs[]>();

      if (error) throw new DataError("time_entries.unbilled", error);
      return data ?? [];
    },
  });
}

/** Finished and running entries in a date window, for the timesheet. */
export function workspaceTimeQuery(
  workspaceId: string | null | undefined,
  fromIso: string,
  toIso: string,
) {
  return queryOptions({
    queryKey: [...qk.workspaceTime(workspaceId ?? undefined), fromIso, toIso] as const,
    enabled: Boolean(workspaceId),
    queryFn: async (): Promise<TimeSheetEntry[]> => {
      const pageSize = 1000;
      const rows: TimeSheetEntry[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("time_entries")
          .select(WITH_PROJECT)
          .eq("workspace_id", workspaceId!)
          .gte("started_at", fromIso)
          .lt("started_at", toIso)
          .order("started_at", { ascending: false })
          .range(from, from + pageSize - 1)
          .returns<TimeSheetEntry[]>();
        if (error) throw new DataError("time_entries.workspace", error);
        const page = data ?? [];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows;
    },
  });
}

export function totalMinutes(entries: Array<Pick<TimeEntry, "duration_minutes">>): number {
  return entries.reduce((total, e) => total + (e.duration_minutes ?? 0), 0);
}

/** "2h 45m", "45m", "—". Hours and minutes read faster than decimal hours. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Live duration of a running entry, in minutes. */
export function elapsedMinutes(startedAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000));
}

/** `h:mm:ss` for a running timer. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Local `YYYY-MM-DD`, the key entries are grouped under. */
export function localDayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Today", "Yesterday", otherwise "Mon, Sep 28". */
export function dayLabel(key: string, now: Date = new Date()): string {
  if (key === localDayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === localDayKey(yesterday)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export interface DayGroup<T> {
  key: string;
  entries: T[];
  minutes: number;
}

/** Entries grouped by local day, newest day first, each with its total. */
export function groupByDay<T extends { started_at: string; duration_minutes: number | null }>(
  entries: readonly T[],
): DayGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const entry of entries) {
    const key = localDayKey(entry.started_at);
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, list]) => ({ key, entries: list, minutes: totalMinutes(list) }));
}
