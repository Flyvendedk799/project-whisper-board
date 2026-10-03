import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Removes files from storage after the rows that pointed at them are gone, best
 * effort: a cascade only reaches rows, and a file that cannot be removed is
 * logged rather than failing a delete that has already happened. Service role,
 * so it never reads rows, only removes objects whose rows the caller's own RLS
 * already let them delete.
 */
export async function purgeFiles(files: Array<{ storage_bucket: string; storage_path: string }>) {
  if (files.length === 0) return;
  const storage = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).storage;

  const byBucket = new Map<string, string[]>();
  for (const file of files) {
    byBucket.set(file.storage_bucket, [
      ...(byBucket.get(file.storage_bucket) ?? []),
      file.storage_path,
    ]);
  }
  for (const [bucket, paths] of byBucket) {
    const { error } = await storage.from(bucket).remove(paths);
    if (error) console.error("[storage] purge files", bucket, error.message);
  }
}
