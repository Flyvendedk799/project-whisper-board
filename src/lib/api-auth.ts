/* eslint-disable no-restricted-syntax */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export interface ApiKeyContext {
  keyId: string;
  workspaceId: string;
  scopes: string[];
}

export async function verifyApiKey(authHeader: string | null): Promise<ApiKeyContext | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return null;
  }

  const hashedKey = createHash("sha256").update(token).digest("hex");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: apiKey, error } = await supabase
    .from("api_keys")
    .select("id, workspace_id, scopes, revoked_at")
    .eq("key_hash", hashedKey)
    .single();

  if (error || !apiKey) {
    return null;
  }

  if (apiKey.revoked_at) {
    return null;
  }

  // Update last_used_at in the background (no await) or await it.
  // For safety and immediate consistency, we can await it or just swallow errors.
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id);

  return {
    keyId: apiKey.id,
    workspaceId: apiKey.workspace_id,
    scopes: apiKey.scopes || [],
  };
}
