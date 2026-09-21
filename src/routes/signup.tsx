import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { createWorkspace } from "@/lib/workspace.functions";
import { useAuth } from "@/components/auth-provider";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create your workspace · Consflow" }] }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const createWs = useServerFn(createWorkspace);
  const { setActiveWorkspace, refetchWorkspaces } = useAuth();
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/app/create-workspace`,
        data: { full_name: name },
      },
    });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }

    // Email confirmation required — no session yet.
    if (!data.session) {
      setBusy(false);
      setCheckEmail(true);
      return;
    }

    try {
      const result = await createWs({
        data: { name: workspaceName.trim() || `${name}'s agency` },
      });
      const ws = result.workspace;
      setActiveWorkspace(ws.id);
      refetchWorkspaces();
      toast.success("Workspace ready");
      navigate({ to: "/app" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create workspace");
      navigate({ to: "/app/create-workspace" });
    } finally {
      setBusy(false);
    }
  }

  if (checkEmail) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <Card className="w-full max-w-md space-y-4 p-8 text-center">
          <h1 className="text-3xl font-display">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to <strong>{email}</strong>. After you confirm, you&rsquo;ll
            finish creating your workspace.
          </p>
          <Button asChild variant="outline">
            <Link to="/login">Back to sign in</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <Card className="w-full max-w-md space-y-6 p-8">
        <div className="space-y-1 text-center">
          <h1 className="text-3xl font-display">Create your workspace</h1>
          <p className="text-sm text-muted-foreground">
            Your agency portal — invite clients, run tickets, and bill from one place.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ws-name">Agency / workspace name</Label>
            <Input
              id="ws-name"
              required
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Northwind Studio"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Creating…" : "Create workspace"}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
