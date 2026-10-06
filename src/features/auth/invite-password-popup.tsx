import { useState, useEffect } from "react";
import { useRouter, useSearch } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/features/auth/password-input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function InvitePasswordPopup() {
  const router = useRouter();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const showPrompt = search.invite_prompt === "true" || search.invite_prompt === true;

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (showPrompt) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [showPrompt]);

  function closeAndClearParams() {
    setOpen(false);
    // Remove the invite_prompt param from the URL without losing other params or navigating away
    router.navigate({
      // @ts-expect-error router typing is very strict outside routes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      search: (prev: any) => {
        const next = { ...prev };
        delete next.invite_prompt;
        return next;
      },
      replace: true,
    });
  }

  async function setPasswordAndContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      closeAndClearParams();
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Password saved");
    closeAndClearParams();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) closeAndClearParams();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set your password</DialogTitle>
          <DialogDescription>
            You’ve been invited! Set a password so you can easily sign in again later.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={setPasswordAndContinue} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="popup-pw">Choose a password (optional)</Label>
            <PasswordInput
              id="popup-pw"
              name="new-password"
              autoComplete="new-password"
              enterKeyHint="go"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={closeAndClearParams} disabled={busy}>
              Skip for now
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
