import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth-provider";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/accept")({
  head: () => ({ meta: [{ title: "Welcome · Consflow" }] }),
  component: InviteAcceptPage,
});

function InviteAcceptPage() {
  const navigate = useNavigate();
  const { user, loading, workspace, setActiveWorkspace, workspaces, needsWorkspace } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // Invites land here after magic/invite link; session may arrive async.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Wait briefly for hash/session from invite redirect.
      const t = setTimeout(() => {
        if (!supabase.auth.getSession) return;
        void supabase.auth.getSession().then(({ data }) => {
          if (!data.session) navigate({ to: "/login", search: { redirect: "/invite/accept" } });
          else setReady(true);
        });
      }, 800);
      return () => clearTimeout(t);
    }
    setReady(true);
  }, [loading, user, navigate]);

  useEffect(() => {
    if (workspaces.length === 1) {
      setActiveWorkspace(workspaces[0]!.id);
    }
  }, [workspaces, setActiveWorkspace]);

  const projectId =
    (user?.user_metadata?.project_id as string | undefined) ??
    (typeof window !== "undefined"
      ? (sessionStorage.getItem("cf.inviteProjectId") ?? undefined)
      : undefined);

  async function setPasswordAndContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      goNext();
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password saved");
    goNext();
  }

  function goNext() {
    if (projectId) {
      navigate({ to: "/app/projects/$projectId", params: { projectId } });
    } else {
      navigate({ to: "/app" });
    }
  }

  if (!ready || loading) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      </div>
    );
  }

  if (needsWorkspace) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <Card className="w-full max-w-md space-y-4 p-8 text-center">
          <h1 className="font-display text-2xl">Invitation not found</h1>
          <p className="text-sm text-muted-foreground">
            Your account is signed in, but you haven&rsquo;t been added to a workspace yet. Ask your
            agency to resend the invite.
          </p>
          <Button asChild variant="outline">
            <Link to="/app">Go to home</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-md space-y-6 p-8">
        <div className="space-y-1 text-center">
          <h1 className="font-display text-3xl">
            Welcome{workspace ? ` to ${workspace.name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            You&rsquo;ve been invited to the client portal. Set a password so you can sign in again
            later, then jump in.
          </p>
        </div>
        <form onSubmit={setPasswordAndContinue} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pw">Choose a password (optional)</Label>
            <Input
              id="pw"
              type="password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Saving…" : projectId ? "Open project" : "Continue to portal"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={goNext}>
            Skip for now
          </Button>
        </form>
      </Card>
    </div>
  );
}
