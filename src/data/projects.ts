import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";
import type { AppRole } from "./enums";
import {
  PERSON_REF_COLUMNS,
  type MemberWithProfile,
  type Milestone,
  type PersonRef,
  type Project,
  type ProjectWithOrg,
  type UpdateWithAuthor,
} from "./types";

export function projectListQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: qk.projectList(workspaceId ?? undefined),
    enabled: Boolean(workspaceId),
    queryFn: async (): Promise<ProjectWithOrg[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, organization:organizations(id, name)")
        .eq("workspace_id", workspaceId!)
        .order("updated_at", { ascending: false })
        .returns<ProjectWithOrg[]>();

      if (error) throw new DataError("projects.list", error);
      return data ?? [];
    },
  });
}

export function projectQuery(projectId: string) {
  return queryOptions({
    queryKey: qk.project(projectId),
    queryFn: async (): Promise<ProjectWithOrg> => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, organization:organizations(id, name)")
        .eq("id", projectId)
        .maybeSingle()
        .returns<ProjectWithOrg | null>();

      if (error) throw new DataError("projects.get", error);
      if (!data) throw new DataError("projects.get", { message: "Not found", code: "PGRST116" });
      return data;
    },
  });
}

export function projectMembersQuery(projectId: string) {
  return queryOptions({
    queryKey: qk.projectMembers(projectId),
    queryFn: async (): Promise<MemberWithProfile[]> => {
      const { data, error } = await supabase
        .from("project_members")
        .select(`*, profile:profiles(${PERSON_REF_COLUMNS})`)
        .eq("project_id", projectId)
        .returns<MemberWithProfile[]>();

      if (error) throw new DataError("project_members.list", error);
      return data ?? [];
    },
  });
}

export function projectMilestonesQuery(projectId: string) {
  return queryOptions({
    queryKey: qk.projectMilestones(projectId),
    queryFn: async (): Promise<Milestone[]> => {
      const { data, error } = await supabase
        .from("milestones")
        .select("*")
        .eq("project_id", projectId)
        .order("position")
        .order("created_at");

      if (error) throw new DataError("milestones.list", error);
      return data ?? [];
    },
  });
}

export function projectUpdatesQuery(projectId: string) {
  return queryOptions({
    queryKey: qk.projectUpdates(projectId),
    queryFn: async (): Promise<UpdateWithAuthor[]> => {
      const { data, error } = await supabase
        .from("project_updates")
        .select(`*, author:profiles(${PERSON_REF_COLUMNS})`)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(100)
        .returns<UpdateWithAuthor[]>();

      if (error) throw new DataError("project_updates.list", error);
      return data ?? [];
    },
  });
}

export type WorkspaceMemberRow = {
  user_id: string;
  role: AppRole;
  created_at: string;
  profile: PersonRef | null;
};

export function workspaceMembersQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: [...qk.workspacePeople(workspaceId ?? undefined), "roles"] as const,
    enabled: Boolean(workspaceId),
    queryFn: async (): Promise<WorkspaceMemberRow[]> => {
      const { data: members, error } = await supabase
        .from("workspace_members")
        .select("user_id, role, created_at")
        .eq("workspace_id", workspaceId!)
        .order("created_at");
      if (error) throw new DataError("workspace_members.list", error);
      const rows = members ?? [];
      if (rows.length === 0) return [];

      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select(PERSON_REF_COLUMNS)
        .in(
          "id",
          rows.map((row) => row.user_id),
        )
        .returns<PersonRef[]>();
      if (profileError) throw new DataError("profiles.list", profileError);

      const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      return rows.map((row) => ({
        user_id: row.user_id,
        role: row.role,
        created_at: row.created_at,
        profile: byId.get(row.user_id) ?? null,
      }));
    },
  });
}

/** Everyone in the active workspace, for assignee pickers and @mentions. */
export function workspacePeopleQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: qk.workspacePeople(workspaceId ?? undefined),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PersonRef[]> => {
      const { data: members, error: membersError } = await supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId!);
      if (membersError) throw new DataError("workspace_members.list", membersError);

      const ids = (members ?? []).map((m) => m.user_id);
      if (ids.length === 0) return [];

      const { data, error } = await supabase
        .from("profiles")
        .select(PERSON_REF_COLUMNS)
        .in("id", ids)
        .order("full_name")
        .returns<PersonRef[]>();

      if (error) throw new DataError("profiles.list", error);
      return data ?? [];
    },
  });
}

export function projectSearchQuery(term: string, workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: [...qk.projects(), "search", workspaceId ?? "none", term] as const,
    enabled: Boolean(workspaceId) && term.trim().length >= 2,
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .ilike("title", `%${term}%`)
        .order("updated_at", { ascending: false })
        .limit(8);

      if (error) throw new DataError("projects.search", error);
      return data ?? [];
    },
  });
}

export function organizationsQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: qk.organizations(workspaceId ?? undefined),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("name");
      if (error) throw new DataError("organizations.list", error);
      return data ?? [];
    },
  });
}
