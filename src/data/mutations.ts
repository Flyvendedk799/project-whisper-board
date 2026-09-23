import { supabase } from "@/integrations/supabase/client";
import type { Insert, Update } from "./types";

/**
 * Direct table writes.
 *
 * Anything privileged, anything with a side effect (a notification, an audit
 * consequence, a computed total) belongs in a server function. What is left is
 * a handful of plain inserts and updates the client is allowed to make under
 * RLS — and even those live here rather than inline, so `src/data` stays the
 * only place the app talks to the database and every one of them is one edit
 * away from being found.
 *
 * These return the PostgREST builder unresolved. `useDataMutation` awaits it,
 * turns an error into a DataError and refuses a success that returned no row.
 */

export const createProject = (input: {
  title: string;
  description?: string | null;
  workspaceId: string;
  organizationId?: string | null;
}) =>
  supabase
    .from("projects")
    .insert({
      title: input.title,
      description: input.description ?? null,
      workspace_id: input.workspaceId,
      organization_id: input.organizationId ?? null,
    })
    .select("*")
    .single();

export const createOrganization = (input: {
  name: string;
  workspaceId: string;
  website?: string | null;
}) =>
  supabase
    .from("organizations")
    .insert({
      name: input.name,
      workspace_id: input.workspaceId,
      website: input.website ?? null,
    })
    .select("*")
    .single();

export const updateProject = (input: { id: string; patch: Update<"projects"> }) =>
  supabase.from("projects").update(input.patch).eq("id", input.id).select("id").single();

export const createMilestone = (input: Insert<"milestones">) =>
  supabase.from("milestones").insert(input).select("*").single();

export const createTicketRow = (input: Insert<"tickets">) =>
  supabase.from("tickets").insert(input).select("id, ticket_number").single();

export const updateOrganization = (input: {
  id: string;
  name: string;
  website?: string | null;
  notes?: string | null;
  logoUrl?: string | null;
}) =>
  supabase
    .from("organizations")
    .update({
      name: input.name,
      website: input.website ?? null,
      notes: input.notes ?? null,
      logo_url: input.logoUrl ?? null,
    })
    .eq("id", input.id)
    .select("*")
    .single();

export const deleteOrganization = (input: { id: string }) =>
  supabase.from("organizations").delete().eq("id", input.id).select("id");

export const reassignOrganizationProjects = (input: { fromId: string; toId: string }) =>
  supabase
    .from("projects")
    .update({ organization_id: input.toId })
    .eq("organization_id", input.fromId)
    .select("id");

export const saveSlaPolicy = (input: {
  workspaceId: string;
  priority: "low" | "medium" | "high" | "urgent";
  firstResponseMinutes: number;
  resolutionMinutes: number;
}) =>
  supabase
    .from("sla_policies")
    .upsert(
      {
        workspace_id: input.workspaceId,
        priority: input.priority,
        first_response_minutes: input.firstResponseMinutes,
        resolution_minutes: input.resolutionMinutes,
      },
      { onConflict: "workspace_id,priority" },
    )
    .select("*")
    .single();

export const upsertWorkspaceLabel = (input: {
  workspaceId: string;
  name: string;
  color: string;
  description?: string | null;
}) =>
  supabase
    .from("workspace_labels")
    .upsert(
      {
        workspace_id: input.workspaceId,
        name: input.name,
        color: input.color,
        description: input.description ?? null,
      },
      { onConflict: "workspace_id,name" },
    )
    .select("*")
    .single();

export const deleteWorkspaceLabel = (input: { id: string }) =>
  supabase.from("workspace_labels").delete().eq("id", input.id).select("id");

export const updateProfile = (input: { id: string; fullName: string }) =>
  supabase
    .from("profiles")
    .update({ full_name: input.fullName })
    .eq("id", input.id)
    .select("id")
    .single();

export const insertAttachment = (input: Insert<"ticket_attachments">) =>
  supabase.from("ticket_attachments").insert(input).select("*").single();

export const removeStorageObject = (bucket: string, paths: string[]) =>
  supabase.storage.from(bucket).remove(paths);

export const uploadToStorage = (bucket: string, path: string, file: File) =>
  supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
