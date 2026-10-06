import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import {
  listMcpConnections,
  revokeMcpConnection,
  type McpConnectionRow,
} from "@/lib/mcp-oauth.functions";
import { toast } from "sonner";

function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** List + revoke hosted MCP OAuth grants. Never shows raw tokens. */
export function ConnectedAgents() {
  const { workspaceId } = useAuth();
  const [rows, setRows] = useState<McpConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listMcpConnections({
        data: workspaceId ? { workspaceId } : undefined,
      });
      setRows(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load connections");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onRevoke(grantId: string) {
    setBusyId(grantId);
    try {
      await revokeMcpConnection({ data: { grantId } });
      toast.success("Connection revoked");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revoke failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-[14px] border bg-card p-4 md:p-5">
      <h2 className="font-display text-xl">Connected agents</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Hosted MCP grants for this workspace. Revoking ends access on the next request. Tokens are
        never shown here.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No hosted MCP connections yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{row.clientName}</p>
                <p className="text-xs text-muted-foreground">
                  <code className="break-all">{row.clientId}</code>
                </p>
                <p className="text-xs text-muted-foreground">Scopes: {row.scopes.join(", ")}</p>
                <p className="text-xs text-muted-foreground">
                  Created {formatWhen(row.createdAt)} · Last used {formatWhen(row.lastUsedAt)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busyId === row.id}
                onClick={() => void onRevoke(row.id)}
                className="shrink-0"
              >
                {busyId === row.id ? "Revoking…" : "Revoke"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
