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

export const createProject = (input: { title: string; description?: string | null }) =>
  supabase
    .from("projects")
    .insert({ title: input.title, description: input.description ?? null })
    .select("*")
    .single();

export const updateProject = (input: { id: string; patch: Update<"projects"> }) =>
  supabase.from("projects").update(input.patch).eq("id", input.id).select("id").single();

export const createMilestone = (input: Insert<"milestones">) =>
  supabase.from("milestones").insert(input).select("*").single();

export const createTicketRow = (input: Insert<"tickets">) =>
  supabase.from("tickets").insert(input).select("id, ticket_number").single();

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
