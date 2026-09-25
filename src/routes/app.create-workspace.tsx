import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth-provider";
import { createWorkspace } from "@/lib/workspace.functions";
import { markOnboardingStart } from "@/components/onboarding-wizard";
import { toast } from "sonner";

const PENDING_WS_NAME_KEY = "cf.pendingWorkspaceName";

export const Route = createFileRoute("/app/create-workspace")({
  head: () => ({ meta: [{ title: "Create workspace · Boared" }] }),
  component: CreateWorkspacePage,
});

function CreateWorkspacePage() {
  const navigate = useNavigate();
  const { user, loading, needsWorkspace, setActiveWorkspace, refetchWorkspaces } = useAuth();
  const createWs = useServerFn(createWorkspace);
  const [name, setName] = useState(() => {
    try {
      return sessionStorage.getItem(PENDING_WS_NAME_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  // Prefill from signup metadata if sessionStorage was cleared.
  useEffect(() => {
    if (name) return;
    const fromMeta = user?.user_metadata?.pending_workspace_name;
    if (typeof fromMeta === "string" && fromMeta.trim()) {
      setName(fromMeta.trim());
    }
  }, [user, name]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await createWs({ data: { name: name.trim() } });
      try {
        sessionStorage.removeItem(PENDING_WS_NAME_KEY);
      } catch {
        /* ignore */
      }
      markOnboardingStart(result.workspace.id);
      setActiveWorkspace(result.workspace.id);
      await refetchWorkspaces();
      toast.success("Workspace created");
      // Hard navigate avoids staying on this route when AppShell still treats
      // /create-workspace as a special shell (no sidebar) after success.
      window.location.assign("/app");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create workspace");
      setBusy(false);
    }
  }

  if (loading || !user) return null;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md space-y-6 p-8">
        <div className="space-y-1 text-center">
          <h1 className="font-display text-3xl">
            {needsWorkspace ? "Name your workspace" : "New workspace"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {needsWorkspace
              ? "This is your agency. Clients you invite will see this name."
              : "Create another agency workspace. You can switch between them anytime."}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ws">Agency name</Label>
            <Input
              id="ws"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Northwind Studio"
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Continue"}
          </Button>
          {!needsWorkspace && (
            <Button type="button" variant="ghost" className="w-full" asChild>
              <Link to="/app">Cancel</Link>
            </Button>
          )}
        </form>
      </Card>
    </div>
  );
}
