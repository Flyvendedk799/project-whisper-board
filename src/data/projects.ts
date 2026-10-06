import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { getProjectDeletionImpact } from "@/lib/projects.functions";
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

/** Lightweight live counts for each project card. RLS limits both sets to visible rows. */
export function projectActivityQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: [...qk.projects(), "activity", workspaceId ?? "none"] as const,
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const [plans, tickets] = await Promise.all([
        supabase
          .from("plans")
          .select("id, project_id, status")
          .eq("workspace_id", workspaceId!)
          .not("status", "in", "(completed,archived)"),
        supabase
          .from("tickets")
          .select("project_id, status")
          .eq("workspace_id", workspaceId!)
          .not("status", "in", "(done,wont_fix)"),
      ]);
      if (plans.error) throw new DataError("projects.planActivity", plans.error);
      if (tickets.error) throw new DataError("projects.ticketActivity", tickets.error);
      const counts: Record<string, { plans: number; tickets: number }> = {};
      const planIdsByProject = new Map<string, Set<string>>();
      for (const plan of plans.data ?? []) {
        if (!plan.project_id) continue;
        const set = planIdsByProject.get(plan.project_id) ?? new Set<string>();
        set.add(plan.id);
        planIdsByProject.set(plan.project_id, set);
      }
      const crossPlanIds = (plans.data ?? [])
        .filter((plan) => !plan.project_id)
        .map((plan) => plan.id);
      if (crossPlanIds.length) {
        const { data: links, error: linkError } = await supabase
          .from("plan_tasks")
          .select("plan_id, ticket_id")
          .in("plan_id", crossPlanIds)
          .not("ticket_id", "is", null);
        if (linkError) throw new DataError("projects.crossPlanLinks", linkError);
        const ticketIds = [
          ...new Set(
            (links ?? []).map((link) => link.ticket_id).filter((id): id is string => Boolean(id)),
          ),
        ];
        if (ticketIds.length) {
          const { data: linkedTickets, error: ticketError } = await supabase
            .from("tickets")
            .select("id, project_id")
            .in("id", ticketIds);
          if (ticketError) throw new DataError("projects.crossPlanTickets", ticketError);
          const projectByTicket = new Map(
            (linkedTickets ?? []).map((ticket) => [ticket.id, ticket.project_id]),
          );
          for (const link of links ?? []) {
            const projectId = link.ticket_id && projectByTicket.get(link.ticket_id);
            if (!projectId) continue;
            const set = planIdsByProject.get(projectId) ?? new Set<string>();
            set.add(link.plan_id);
            planIdsByProject.set(projectId, set);
          }
        }
      }
      for (const [projectId, planIds] of planIdsByProject) {
        counts[projectId] ??= { plans: 0, tickets: 0 };
        counts[projectId].plans = planIds.size;
      }
      for (const ticket of tickets.data ?? []) {
        counts[ticket.project_id] ??= { plans: 0, tickets: 0 };
        counts[ticket.project_id].tickets += 1;
      }
      return counts;
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

/** What deleting the project would take with it. Only asked for when the dialog is open. */
export function projectDeletionImpactQuery(projectId: string, enabled: boolean) {
  return queryOptions({
    queryKey: qk.projectImpact(projectId),
    enabled,
    gcTime: 0,
    queryFn: () => getProjectDeletionImpact({ data: { projectId } }),
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
  /** Invited and never signed in. */
  pending: boolean;
  /** Only filled in for admins and client leads. */
  invited_at: string | null;
  last_sign_in_at: string | null;
};

/** A person in the workspace, as pickers and chips use them. */
export type WorkspacePerson = PersonRef & { role: AppRole; pending: boolean };

/** PostgREST and Postgres both say "no such function" while a migration is still on its way. */
function isMissingFunction(error: { code?: string; message?: string }) {
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function/i.test(error.message ?? "")
  );
}

/**
 * Everyone in a workspace with their profile and invite state, from
 * `workspace_people()`. Falls back to the member and profile tables (no
 * pending state) if the database has not been migrated yet, so a deploy that
 * lands before its migration still lists people.
 */
export async function loadWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRow[]> {
  const { data, error } = await supabase.rpc("workspace_people", { _workspace_id: workspaceId });
  if (!error) {
    return (data ?? []).map((row) => ({
      user_id: row.user_id,
      role: row.role,
      created_at: row.joined_at,
      pending: Boolean(row.pending),
      invited_at: row.invited_at ?? null,
      last_sign_in_at: row.last_sign_in_at ?? null,
      profile: {
        id: row.user_id,
        full_name: row.full_name,
        email: row.email,
        avatar_url: row.avatar_url,
      },
    }));
  }
  if (!isMissingFunction(error)) throw new DataError("workspace_people", error);

  const { data: members, error: membersError } = await supabase
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at");
  if (membersError) throw new DataError("workspace_members.list", membersError);
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
    pending: false,
    invited_at: null,
    last_sign_in_at: null,
    profile: byId.get(row.user_id) ?? null,
  }));
}

export function workspaceMembersQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: [...qk.workspacePeople(workspaceId ?? undefined), "roles"] as const,
    enabled: Boolean(workspaceId),
    queryFn: () => loadWorkspaceMembers(workspaceId!),
  });
}

/** Members as people, signed-in first, then by name. */
export function toWorkspacePeople(rows: readonly WorkspaceMemberRow[]): WorkspacePerson[] {
  return rows
    .map((row) => ({
      id: row.user_id,
      full_name: row.profile?.full_name ?? null,
      email: row.profile?.email ?? null,
      avatar_url: row.profile?.avatar_url ?? null,
      role: row.role,
      pending: row.pending,
    }))
    .sort(
      (a, b) =>
        Number(a.pending) - Number(b.pending) ||
        (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""),
    );
}

/** Everyone in the active workspace, for assignee pickers and @mentions. */
export function workspacePeopleQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: qk.workspacePeople(workspaceId ?? undefined),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<WorkspacePerson[]> =>
      toWorkspacePeople(await loadWorkspaceMembers(workspaceId!)),
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

export type OrganizationMemberRow = { organization_id: string; user_id: string };

/** Which client logins belong to which company. Admins see all; clients see their own company. */
export function organizationMembersQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: [...qk.organizations(workspaceId ?? undefined), "members"] as const,
    enabled: Boolean(workspaceId),
    queryFn: async (): Promise<OrganizationMemberRow[]> => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("organization_id, user_id")
        .eq("workspace_id", workspaceId!);
      if (error) throw new DataError("organization_members.list", error);
      return data ?? [];
    },
  });
}

/**
 * Groups member rows by company, keeping only ids that are still people in the
 * workspace (a removed member can linger here until the next refresh).
 */
export function peopleByOrganization<T extends { user_id: string }>(
  links: OrganizationMemberRow[],
  people: T[],
): Map<string, T[]> {
  const byUser = new Map(people.map((person) => [person.user_id, person]));
  const grouped = new Map<string, T[]>();
  for (const link of links) {
    const person = byUser.get(link.user_id);
    if (!person) continue;
    grouped.set(link.organization_id, [...(grouped.get(link.organization_id) ?? []), person]);
  }
  return grouped;
}
