import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";
import type { Notification, NotificationPreferences } from "./types";

export function notificationListQuery() {
  return queryOptions({
    queryKey: qk.notificationList(),
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw new DataError("notifications.list", error);
      return data ?? [];
    },
  });
}

export function unreadCountQuery() {
  return queryOptions({
    queryKey: qk.notificationCount(),
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);

      if (error) throw new DataError("notifications.count", error);
      return count ?? 0;
    },
  });
}

export function notificationPreferencesQuery(userId: string) {
  return queryOptions({
    queryKey: qk.notificationPrefs(),
    queryFn: async (): Promise<NotificationPreferences | null> => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw new DataError("notification_preferences.get", error);
      return data;
    },
  });
}

/**
 * `channels` is jsonb, so it arrives as `Json` and has to be read defensively —
 * a preference row written by an older version may not have every key.
 */
export function channelEnabled(
  prefs: NotificationPreferences | null | undefined,
  kind: string,
  channel: "in_app" | "email",
): boolean {
  if (!prefs) return true;
  const channels = prefs.channels;
  if (typeof channels !== "object" || channels === null || Array.isArray(channels)) return true;
  const forKind = (channels as Record<string, unknown>)[kind];
  if (typeof forKind !== "object" || forKind === null || Array.isArray(forKind)) return true;
  const value = (forKind as Record<string, unknown>)[channel];
  return typeof value === "boolean" ? value : true;
}
