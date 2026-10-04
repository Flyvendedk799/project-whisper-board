import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/features/auth/password-input";
import { Segmented } from "@/components/status-pill";
import { AuthCard } from "@/features/auth/auth-card";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    redirect: z.string().optional(),
    continue: z.enum(["workspace"]).optional(),
  }),
  head: () => ({ meta: [{ title: "Sign in · Boared" }] }),
  component: LoginPage,
});

function readPendingWorkspaceName(): string | null {
  try {
    return sessionStorage.getItem("cf.pendingWorkspaceName");
  } catch {
    return null;
  }
}

function LoginPage() {
  const navigate = useNavigate();
  const { redirect, continue: continueTo } = Route.useSearch();
  const pendingWorkspace = useMemo(() => readPendingWorkspaceName(), []);
  const finishingSignup = continueTo === "workspace" || Boolean(pendingWorkspace);

  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  function afterSignIn() {
    if (redirect) {
      void navigate({ href: redirect });
      return;
    }
    if (finishingSignup) {
      void navigate({ to: "/app/create-workspace" });
      return;
    }
    void navigate({ to: "/app" });
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(finishingSignup ? "Welcome — let's finish your workspace" : "Welcome back");
    afterSignIn();
  }

  async function handleMagic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}${
          finishingSignup ? "/app/create-workspace" : "/app"
        }`,
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(
      finishingSignup
        ? "Check your email — the link continues to create your workspace"
        : "Check your email for a sign-in link",
    );
  }

  return (
    <AuthCard
      title="Boared"
      subtitle={
        finishingSignup ? (
          <>
            <p>
              Email confirmed? Sign in to finish creating{" "}
              {pendingWorkspace ? <strong>{pendingWorkspace}</strong> : "your workspace"}.
            </p>
            <p className="mt-1 text-xs">Next step: name your agency and you&rsquo;re in.</p>
          </>
        ) : (
          "Sign in to your workspace"
        )
      }
      width="max-w-[420px]"
    >
      <Segmented
        label="Sign-in method"
        value={mode}
        onChange={setMode}
        className="flex w-full [&>button]:h-8 [&>button]:flex-1 max-md:[&>button]:h-11"
        options={[
          { value: "password", label: "Password" },
          { value: "magic", label: "Magic link" },
        ]}
      />
      <form onSubmit={mode === "password" ? handlePassword : handleMagic} className="space-y-4">
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
            enterKeyHint={mode === "password" ? "next" : "send"}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {mode === "password" && (
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              enterKeyHint="go"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
        <Button type="submit" className="h-11 w-full max-md:h-12" disabled={busy}>
          {busy
            ? "..."
            : mode === "password"
              ? finishingSignup
                ? "Continue to create workspace"
                : "Sign in"
              : "Send magic link"}
        </Button>
      </form>
      <div className="text-center text-sm text-muted-foreground space-y-1 max-md:space-y-0">
        <p className="max-md:flex max-md:min-h-11 max-md:items-center max-md:justify-center max-md:gap-1">
          New here?{" "}
          <Link
            to="/signup"
            className="text-primary underline max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-1"
          >
            Create an account
          </Link>
        </p>
        <p>
          <button
            type="button"
            className="text-primary underline max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-3"
            onClick={async () => {
              if (!email) return toast.error("Enter your email first");
              const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
              });
              if (error) return toast.error(error.message);
              toast.success("Password reset email sent");
            }}
          >
            Forgot password?
          </button>
        </p>
      </div>
    </AuthCard>
  );
}
