import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { CredentialStore, StoredRecord } from "@flyvendedk799/ai-auth";

interface CredentialRow {
  key: string;
  payload: string;
  meta: StoredRecord["meta"];
  updated_at?: string;
}

/**
 * `types.ts` is generated from the database and does not name this table yet —
 * it will after the next `npm run db:types`, which now reads the local stack.
 * Until then the table is described here rather than left as `any`, so the
 * columns are still checked against something.
 */
const credentials = () =>
  (
    supabaseAdmin as unknown as {
      from: (table: "ai_credentials") => {
        select: (columns: string) => {
          eq: (
            column: "key",
            value: string,
          ) => {
            maybeSingle: () => Promise<{
              data: CredentialRow | null;
              error: { message: string } | null;
            }>;
          };
        };
        upsert: (
          row: CredentialRow,
          options: { onConflict: "key" },
        ) => Promise<{ error: { message: string } | null }>;
        delete: () => {
          eq: (column: "key", value: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    }
  ).from("ai_credentials");

/**
 * The credential store, backed by the app's own database.
 *
 * `ai-auth` defines the store as three methods over an opaque sealed payload,
 * so where it lives is the host's choice. The alternatives were a JSON file on
 * the host — which is not backed up and does not survive the service being
 * re-provisioned — or a second Postgres connection. This uses the database the
 * app already has, through the service-role client.
 *
 * The payload arrives sealed; nothing here encrypts, decrypts, or inspects it.
 */
export class SupabaseCredentialStore implements CredentialStore {
  async read(key: string): Promise<StoredRecord | null> {
    const { data, error } = await credentials()
      .select("payload, meta")
      .eq("key", key)
      .maybeSingle();

    // A read failure must not look like "no credential": that would silently
    // start a fresh login over a connection that is actually fine.
    if (error) throw new Error(`ai_credentials.read: ${error.message}`);
    if (!data) return null;

    return {
      payload: data.payload,
      meta: data.meta ?? {},
    };
  }

  async write(key: string, record: StoredRecord): Promise<void> {
    const { error } = await credentials().upsert(
      {
        key,
        payload: record.payload,
        meta: record.meta,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) throw new Error(`ai_credentials.write: ${error.message}`);
  }

  async delete(key: string): Promise<void> {
    const { error } = await credentials().delete().eq("key", key);
    if (error) throw new Error(`ai_credentials.delete: ${error.message}`);
  }
}
