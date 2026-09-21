import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    redirect: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: "Sign in · Consflow" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome back");
    if (redirect) {
      void navigate({ href: redirect });
    } else {
      void navigate({ to: "/app" });
    }
  }

  async function handleMagic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/app` },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Check your email for a sign-in link");
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-display">Consflow</h1>
          <p className="text-sm text-muted-foreground">Sign in to your workspace</p>
        </div>
        <div className="flex gap-1 p-1 bg-muted rounded-md text-sm">
          <button
            type="button"
            onClick={() => setMode("password")}
            className={`flex-1 py-1.5 rounded ${mode === "password" ? "bg-background shadow-sm" : ""}`}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => setMode("magic")}
            className={`flex-1 py-1.5 rounded ${mode === "magic" ? "bg-background shadow-sm" : ""}`}
          >
            Magic link
          </button>
        </div>
        <form onSubmit={mode === "password" ? handlePassword : handleMagic} className="space-y-4">
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
          {mode === "password" && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "..." : mode === "password" ? "Sign in" : "Send magic link"}
          </Button>
        </form>
        <div className="text-center text-sm text-muted-foreground space-y-1">
          <p>
            New here?{" "}
            <Link to="/signup" className="text-primary underline">
              Create an account
            </Link>
          </p>
          <p>
            <button
              type="button"
              className="text-primary underline"
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
      </Card>
    </div>
  );
}
