import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";
import {
  PERSON_REF_COLUMNS,
  type MemberWithProfile,
  type Milestone,
  type PersonRef,
  type Project,
  type ProjectWithOrg,
  type UpdateWithAuthor,
} from "./types";

export function projectListQuery() {
  return queryOptions({
    queryKey: qk.projectList(),
    queryFn: async (): Promise<ProjectWithOrg[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, organization:organizations(id, name)")
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

/** Everyone in the workspace, for assignee pickers and @mentions. */
export function workspacePeopleQuery() {
  return queryOptions({
    queryKey: qk.workspacePeople(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PersonRef[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select(PERSON_REF_COLUMNS)
        .order("full_name")
        .returns<PersonRef[]>();

      if (error) throw new DataError("profiles.list", error);
      return data ?? [];
    },
  });
}

export function projectSearchQuery(term: string) {
  return queryOptions({
    queryKey: [...qk.projects(), "search", term] as const,
    enabled: term.trim().length >= 2,
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .ilike("title", `%${term}%`)
        .order("updated_at", { ascending: false })
        .limit(8);

      if (error) throw new DataError("projects.search", error);
      return data ?? [];
    },
  });
}

export function organizationsQuery() {
  return queryOptions({
    queryKey: [...qk.all, "organizations"] as const,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("*").order("name");
      if (error) throw new DataError("organizations.list", error);
      return data ?? [];
    },
  });
}
