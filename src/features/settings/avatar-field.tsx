import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/person-avatar";
import { supabase } from "@/integrations/supabase/client";
import { removeStorageObject, updateProfileAvatar } from "@/data/mutations";
import { qk } from "@/data/keys";
import { useOwnPerson } from "@/hooks/use-own-person";
import {
  AVATAR_ACCEPT,
  AVATAR_BUCKET,
  avatarFileProblem,
  avatarObjectPath,
  ownAvatarObject,
} from "@/lib/avatar";

/** Your photo in Settings: upload a new one or go back to initials. */
export function AvatarField() {
  const person = useOwnPerson();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

  if (!person?.id) return null;
  const userId = person.id;
  const current = person.avatar_url ?? null;

  const saved = async (previous: string | null) => {
    const old = ownAvatarObject(previous, userId);
    if (old) void removeStorageObject(AVATAR_BUCKET, [old]);
    await queryClient.invalidateQueries({ queryKey: qk.profiles() });
  };

  const upload = async (file: File) => {
    const problem = avatarFileProblem(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy("upload");
    try {
      const path = avatarObjectPath(userId, file.type);
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const url = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
      const { error } = await updateProfileAvatar({ id: userId, avatarUrl: url });
      if (error) {
        void removeStorageObject(AVATAR_BUCKET, [path]);
        throw error;
      }
      await saved(current);
      toast.success("Photo updated");
    } catch {
      toast.error("Couldn't upload that photo. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      const { error } = await updateProfileAvatar({ id: userId, avatarUrl: null });
      if (error) throw error;
      await saved(current);
      toast.success("Photo removed");
    } catch {
      toast.error("Couldn't remove your photo. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <PersonAvatar person={person} size="xl" />
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-md:h-11"
            disabled={busy !== null}
            onClick={() => input.current?.click()}
          >
            {busy === "upload" ? "Uploading…" : current ? "Change photo" : "Upload photo"}
          </Button>
          {current ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="max-md:h-11"
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              {busy === "remove" ? "Removing…" : "Remove"}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">PNG, JPEG, WebP or GIF, up to 2 MB.</p>
        <input
          ref={input}
          type="file"
          accept={AVATAR_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Profile photo"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
    </div>
  );
}
