/* eslint-disable react-refresh/only-export-components -- provider + hook share this module */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { qk } from "@/data/keys";
import { toUserMessage } from "@/lib/errors";
import { registerPlanAttachment } from "@/lib/planner.functions";
import {
  attachmentKindOf,
  effectiveMimeType,
  partitionUploadable,
  planAttachmentPath,
} from "@/lib/upload";
import { uploadPlanFile } from "./plan-upload";

export interface UploadItem {
  id: string;
  /** The task the file is going onto; null for a file on the plan itself. */
  taskId: string | null;
  name: string;
  size: number;
  type: string;
  progress: number;
  status: "uploading" | "saving" | "error";
  error?: string;
  /** Object URL for a local preview while the file is still going up. */
  previewUrl?: string;
  /** True for files picked in the note composer. */
  composer: boolean;
  /** The row the server created, once it exists. */
  attachmentId?: string;
}

export interface UploadOptions {
  /** These belong to the note being written. */
  composer?: boolean;
  /** Marks the file as a marked-up copy of this attachment. */
  sourceAttachmentId?: string;
  width?: number;
  height?: number;
  quiet?: boolean;
}

interface UploadsValue {
  uploads: UploadItem[];
  /** Resolves with the ids of the attachments that were saved. A null `taskId` puts them on the plan itself. */
  upload: (taskId: string | null, files: File[], options?: UploadOptions) => Promise<string[]>;
  dismiss: (id: string) => void;
}

const UploadsContext = createContext<UploadsValue | null>(null);

export function usePlanUploads(): UploadsValue {
  const value = useContext(UploadsContext);
  if (!value) throw new Error("usePlanUploads must be used inside <PlanUploadsProvider>");
  return value;
}

let counter = 0;

/**
 * One place where files go up: validation, the progress shown on tiles, the
 * server registration, and cleanup. Cards, sections, the drawer and the note
 * composer all call `upload`, so they behave identically.
 */
export function PlanUploadsProvider({
  planId,
  children,
}: {
  planId: string;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const register = useServerFn(registerPlanAttachment);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const previews = useRef(new Map<string, string>());

  const patch = useCallback((id: string, change: Partial<UploadItem>) => {
    setUploads((current) => current.map((u) => (u.id === id ? { ...u, ...change } : u)));
  }, []);

  const remove = useCallback((id: string) => {
    setUploads((current) => current.filter((u) => u.id !== id));
    const url = previews.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      previews.current.delete(id);
    }
  }, []);

  const upload = useCallback<UploadsValue["upload"]>(
    async (taskId, files, options = {}) => {
      if (!user) {
        toast.error("Sign in again to attach files.");
        return [];
      }
      const { ok, problems } = partitionUploadable(files);
      for (const problem of problems) toast.error(problem);
      if (ok.length === 0) return [];

      const saved: string[] = [];
      const names: string[] = [];
      const mine: string[] = [];

      await Promise.all(
        ok.map(async (file) => {
          const id = `upload-${++counter}`;
          mine.push(id);
          const name = file.name || "pasted-image.png";
          const previewUrl =
            attachmentKindOf(file.type) === "image" ? URL.createObjectURL(file) : undefined;
          if (previewUrl) previews.current.set(id, previewUrl);
          setUploads((current) => [
            ...current,
            {
              id,
              taskId,
              name,
              size: file.size,
              type: file.type,
              progress: 0,
              status: "uploading",
              previewUrl,
              composer: Boolean(options.composer),
            },
          ]);

          const path = planAttachmentPath(user.id, planId, taskId, name);
          try {
            await uploadPlanFile(file, path, (progress) => patch(id, { progress }));
            patch(id, { status: "saving", progress: 100 });
            const row = await register({
              data: {
                ...(taskId ? { taskId } : { planId }),
                storagePath: path,
                fileName: name,
                mimeType: effectiveMimeType(name, file.type) || null,
                sizeBytes: file.size,
                sourceAttachmentId: options.sourceAttachmentId ?? null,
                width: options.width ?? null,
                height: options.height ?? null,
                quiet: ok.length > 1 || options.quiet,
              },
            });
            saved.push(row.id);
            names.push(name);
            patch(id, { attachmentId: row.id });
          } catch (error) {
            const message = toUserMessage(error, `${name} could not be attached.`);
            patch(id, { status: "error", error: message });
            toast.error(message);
            setTimeout(() => remove(id), 4000);
            return;
          }
        }),
      );

      if (saved.length > 0) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: qk.planAttachments(planId) }),
          queryClient.invalidateQueries({ queryKey: qk.planEvents(planId) }),
        ]);
        toast.success(
          names.length === 1 ? `${names[0]} attached` : `${names.length} files attached`,
        );
      }
      // Drop the local placeholders now that real rows are in the cache.
      setUploads((current) => current.filter((u) => u.status === "error" || !mine.includes(u.id)));
      for (const id of mine) {
        const url = previews.current.get(id);
        if (url && saved.length > 0) {
          URL.revokeObjectURL(url);
          previews.current.delete(id);
        }
      }
      return saved;
    },
    [user, planId, patch, remove, register, queryClient],
  );

  const value = useMemo(() => ({ uploads, upload, dismiss: remove }), [uploads, upload, remove]);

  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}
