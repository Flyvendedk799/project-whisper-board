import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";
import { PERSON_REF_COLUMNS, type TimeEntry, type TimeEntryWithRefs } from "./types";

const WITH_REFS = `*, ticket:tickets(id, ticket_number, title), user:profiles(${PERSON_REF_COLUMNS})`;

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
