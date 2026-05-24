import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { user, isAdmin } = useAuth();
  const [name, setName] = useState(user?.user_metadata?.full_name ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", user.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  }

  async function sendReset() {
    if (!user?.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return toast.error(error.message);
    toast.success("Password reset email sent");
  }

  return (
    <>
      <PageHeader title="Settings" description="Your profile and account." />
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 md:py-10 space-y-6">
        <Card className="p-6 space-y-4">
          <h3 className="font-display text-xl">Profile</h3>
          <div className="space-y-2"><Label>Email</Label><Input value={user?.email ?? ""} disabled /></div>
          <div className="space-y-2"><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="flex justify-end"><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button></div>
        </Card>
        <Card className="p-6 space-y-3">
          <h3 className="font-display text-xl">Security</h3>
          <p className="text-sm text-muted-foreground">Change your password by sending yourself a secure reset link.</p>
          <Button variant="outline" onClick={sendReset}>Send password reset email</Button>
        </Card>
        <Card className="p-6 space-y-2">
          <h3 className="font-display text-xl">Role</h3>
          <p className="text-sm text-muted-foreground">You are signed in as <strong>{isAdmin ? "Admin" : "Client"}</strong>.</p>
        </Card>
      </div>
    </>
  );
}
