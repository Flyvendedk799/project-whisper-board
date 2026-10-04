import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/features/auth/password-input";
import { AuthCard } from "@/features/auth/auth-card";
import { toast } from "sonner";
import { createWorkspace } from "@/lib/workspace.functions";
import { useAuth } from "@/components/auth-provider";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create your workspace · Boared" }] }),
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
  const [step, setStep] = useState<1 | 2>(1);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Step one only collects the account; the agency name comes next.
    if (step === 1) {
      setStep(2);
      return;
    }
    setBusy(true);
    // Persist name so create-workspace can prefill after email confirmation.
    try {
      sessionStorage.setItem("cf.pendingWorkspaceName", workspaceName.trim());
    } catch {
      /* ignore */
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/app/create-workspace`,
        data: {
          full_name: name,
          pending_workspace_name: workspaceName.trim(),
        },
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
      <AuthCard
        title="Check your email"
        subtitle={
          <>
            We sent a confirmation link to <strong>{email}</strong>. After you confirm, you&rsquo;ll
            finish creating <strong>{workspaceName || "your workspace"}</strong>.
          </>
        }
      >
        <p className="text-center text-xs text-muted-foreground">
          Already confirmed?{" "}
          <Link to="/login" search={{ continue: "workspace" }} className="text-primary underline">
            Sign in to create your workspace
          </Link>
          .
        </p>
        <Button asChild variant="outline" className="h-11 w-full">
          <Link to="/login" search={{ continue: "workspace" }}>
            Continue to create workspace
          </Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your workspace"
      subtitle="Two steps: your account, then your agency name."
      width="max-w-[440px]"
    >
      <p className="text-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Step {step} of 2
      </p>
      <form onSubmit={submit} className="space-y-4">
        {step === 1 ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="next"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="new-password"
                enterKeyHint="go"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="h-11 w-full max-md:h-12">
              Continue
            </Button>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="ws-name">Agency / workspace name</Label>
              <Input
                id="ws-name"
                name="organization"
                autoComplete="organization"
                autoCapitalize="words"
                enterKeyHint="go"
                required
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Northwind Studio"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Clients you invite will see this name in their portal.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 max-md:h-12"
                disabled={busy}
                onClick={() => setStep(1)}
              >
                Back
              </Button>
              <Button type="submit" className="h-11 flex-1 max-md:h-12" disabled={busy}>
                {busy ? "Creating…" : "Create workspace"}
              </Button>
            </div>
          </>
        )}
      </form>
      <p className="text-center text-sm text-muted-foreground max-md:flex max-md:items-center max-md:justify-center max-md:gap-1">
        Already have an account?{" "}
        <Link
          to="/login"
          className="text-primary underline max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-1"
        >
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
