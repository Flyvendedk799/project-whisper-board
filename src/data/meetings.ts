import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";
import type { MeetingWithActionItems } from "./types";

export function projectMeetingsQuery(projectId: string) {
  return queryOptions({
    queryKey: qk.projectMeetings(projectId),
    queryFn: async (): Promise<MeetingWithActionItems[]> => {
      const { data, error } = await supabase
        .from("meetings")
        .select("*, meeting_action_items(*)")
        .eq("project_id", projectId)
        .order("scheduled_at", { ascending: false })
        .returns<MeetingWithActionItems[]>();

      if (error) throw new DataError("meetings.list", error);
      return data ?? [];
    },
  });
}

/** The next meeting across every project the viewer can see. */
export function upcomingMeetingsQuery() {
  return queryOptions({
    queryKey: [...qk.meetings(), "upcoming"] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select("*, project:projects(id, title, status)")
        .eq("status", "scheduled")
        .gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at")
        .limit(5);

      if (error) throw new DataError("meetings.upcoming", error);
      return data ?? [];
    },
  });
}
