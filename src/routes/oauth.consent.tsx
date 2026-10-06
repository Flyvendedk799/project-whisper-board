import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  approveMcpConsent,
  cancelMcpConsent,
  getMcpConsentContext,
} from "@/lib/mcp-oauth.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/oauth/consent")({
  validateSearch: z.object({
    request_id: z.string().uuid().optional(),
  }),
  head: () => ({ meta: [{ title: "Authorize MCP · Boared" }] }),
  component: ConsentPage,
});

const WRITE_SCOPES = new Set(["planner:write", "account:write", "github:write", "github:merge"]);

function ConsentPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { request_id: requestId } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getMcpConsentContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loginRedirect = useMemo(() => {
    if (!requestId) return "/login";
    const path = `/oauth/consent?request_id=${encodeURIComponent(requestId)}`;
    return `/login?redirect=${encodeURIComponent(path)}`;
  }, [requestId]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      void navigate({ href: loginRedirect });
      return;
    }
    if (!requestId) {
      setError("Missing authorization request.");
      return;
    }
    let cancelled = false;
    void getMcpConsentContext({ data: { requestId } })
      .then((result) => {
        if (cancelled) return;
        setCtx(result);
        setScopes([...result.scopes]);
        if (result.workspaces[0]) setWorkspaceId(result.workspaces[0].workspaceId);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "Could not load consent.");
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user, requestId, loginRedirect, navigate]);

  const hasWrite = scopes.some((s) => WRITE_SCOPES.has(s));

  async function onApprove(e: React.FormEvent) {
    e.preventDefault();
    if (!requestId || !workspaceId) return;
    setBusy(true);
    try {
      const { redirectTo } = await approveMcpConsent({
        data: { requestId, workspaceId, scopes },
      });
      window.location.assign(redirectTo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approve failed");
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!requestId) return;
    setBusy(true);
    try {
      const { redirectTo } = await cancelMcpConsent({ data: { requestId } });
      window.location.assign(redirectTo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
      setBusy(false);
    }
  }

  function toggleScope(scope: string) {
    setScopes((prev) => {
      if (prev.includes(scope)) {
        // Keep corresponding read when removing write is fine; disallow removing last scope
        const next = prev.filter((s) => s !== scope);
        return next.length > 0 ? next : prev;
      }
      // Never add scopes beyond what was requested
      if (!ctx?.scopes.includes(scope as (typeof ctx.scopes)[number])) return prev;
      return [...prev, scope];
    });
  }

  if (loading || (!ctx && !error && user)) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <p className="text-sm text-muted-foreground">Loading authorization…</p>
      </main>
    );
  }

  if (error || !ctx) {
    return (
      <main className="mx-auto max-w-lg space-y-4 px-4 py-16">
        <h1 className="font-display text-2xl">Cannot authorize</h1>
        <p className="text-sm text-muted-foreground">{error ?? "Unknown request."}</p>
        <Button asChild variant="outline">
          <Link to="/app/agents">Back to Agents</Link>
        </Button>
      </main>
    );
  }

  if (ctx.workspaces.length === 0) {
    return (
      <main className="mx-auto max-w-lg space-y-4 px-4 py-16">
        <h1 className="font-display text-2xl">Admin access required</h1>
        <p className="text-sm text-muted-foreground">
          Hosted MCP can only be granted by a workspace admin. Ask an admin, or create a workspace
          first.
        </p>
        <Button asChild>
          <Link to="/app">Go to Boared</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-12">
      <div>
        <h1 className="font-display text-2xl">Connect an agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <strong>{ctx.clientName}</strong> wants access to Boared MCP on your behalf. Approve only
          if you trust this client.
        </p>
      </div>

      <form onSubmit={onApprove} className="space-y-5 rounded-[14px] border bg-card p-5">
        <div className="space-y-2">
          <Label htmlFor="workspace">Workspace</Label>
          <select
            id="workspace"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            required
          >
            {ctx.workspaces.map((ws) => (
              <option key={ws.workspaceId} value={ws.workspaceId}>
                {ws.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Scopes</legend>
          <p className="text-xs text-muted-foreground">You may remove scopes, not add new ones.</p>
          <ul className="space-y-2">
            {ctx.scopes.map((scope) => (
              <li key={scope} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  id={`scope-${scope}`}
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                />
                <label htmlFor={`scope-${scope}`}>
                  <code className="text-xs">{scope}</code>
                  {WRITE_SCOPES.has(scope) ? (
                    <span className="ml-2 text-xs text-amber-700">write</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {hasWrite ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            This grant includes write or merge scopes. The agent can change plans, tickets, or
            GitHub on this workspace.
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Resource: <code>{ctx.resource}</code>
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void onCancel()}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !workspaceId || scopes.length === 0}>
            {busy ? "Working…" : "Approve"}
          </Button>
        </div>
      </form>
    </main>
  );
}
