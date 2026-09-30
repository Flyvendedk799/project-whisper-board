/* eslint-disable react-refresh/only-export-components -- provider + hook share this module */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { qk } from "@/data/keys";
import { planAttachmentsQuery } from "@/data/planner";
import type { PlanAttachmentWithUrl } from "@/data";
import { toUserMessage } from "@/lib/errors";
import {
  deletePlanAttachment,
  setPlanAttachmentShared,
  signPlanAttachmentDownload,
} from "@/lib/planner.functions";
import { groupAttachmentsByTask, visibleAttachments } from "./plan-model";
import { usePlanUploads, type UploadItem } from "./use-plan-uploads";

export const FILE_UNDO_MS = 5000;

interface PlanMediaValue {
  /** Files that are showing: a marked-up copy stands in for its original. */
  visible: PlanAttachmentWithUrl[];
  byTask: Map<string, PlanAttachmentWithUrl[]>;
  /** Every file on the task including superseded originals, for look-ups by id. */
  lookup: (id: string) => PlanAttachmentWithUrl | undefined;
  uploads: UploadItem[];
  upload: ReturnType<typeof usePlanUploads>["upload"];
  dismissUpload: (id: string) => void;
  remove: (attachment: PlanAttachmentWithUrl) => void;
  setShared: (attachment: PlanAttachmentWithUrl, shared: boolean) => void;
  download: (attachment: PlanAttachmentWithUrl) => void;
  isLoading: boolean;
}

const PlanMediaContext = createContext<PlanMediaValue | null>(null);

export function usePlanMedia(): PlanMediaValue {
  const value = useContext(PlanMediaContext);
  if (!value) throw new Error("usePlanMedia must be used inside <PlanMediaProvider>");
  return value;
}

/** Files on a plan plus everything you can do to them, shared by cards, drawer and lightbox. */
export function PlanMediaProvider({
  planId,
  children,
}: {
  planId: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const query = useQuery(planAttachmentsQuery(planId));
  const { uploads, upload, dismiss } = usePlanUploads();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const deleteFn = useServerFn(deletePlanAttachment);
  const shareFn = useServerFn(setPlanAttachmentShared);
  const signFn = useServerFn(signPlanAttachmentDownload);
  const deleteRef = useRef(deleteFn);
  deleteRef.current = deleteFn;

  const refreshFiles = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.planAttachments(planId) }),
        queryClient.invalidateQueries({ queryKey: qk.planEvents(planId) }),
      ]),
    [queryClient, planId],
  );

  const all = useMemo(
    () =>
      ((query.data?.attachments ?? []) as unknown as PlanAttachmentWithUrl[]).filter(
        (a) => !hidden.has(a.id),
      ),
    [query.data, hidden],
  );
  const visible = useMemo(() => visibleAttachments(all), [all]);
  const byTask = useMemo(() => groupAttachmentsByTask(all), [all]);

  const commit = useCallback(
    async (id: string) => {
      timers.current.delete(id);
      try {
        await deleteRef.current({ data: { attachmentId: id } });
      } catch (error) {
        toast.error(toUserMessage(error, "That file could not be removed."));
      } finally {
        setHidden((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        await refreshFiles();
      }
    },
    [refreshFiles],
  );

  const remove = useCallback<PlanMediaValue["remove"]>(
    (attachment) => {
      setHidden((current) => new Set(current).add(attachment.id));
      timers.current.set(
        attachment.id,
        setTimeout(() => void commit(attachment.id), FILE_UNDO_MS + 400),
      );
      toast(
        attachment.source_attachment_id ? "Markup removed, original restored" : "File removed",
        {
          duration: FILE_UNDO_MS,
          action: {
            label: "Undo",
            onClick: () => {
              const timer = timers.current.get(attachment.id);
              if (timer) clearTimeout(timer);
              timers.current.delete(attachment.id);
              setHidden((current) => {
                const next = new Set(current);
                next.delete(attachment.id);
                return next;
              });
            },
          },
        },
      );
    },
    [commit],
  );

  // Leaving the plan makes pending removals real.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of [...pending.keys()]) {
        const timer = pending.get(id);
        if (timer) clearTimeout(timer);
        pending.delete(id);
        void deleteRef.current({ data: { attachmentId: id } }).catch(() => {});
      }
    };
  }, []);

  const setShared = useCallback<PlanMediaValue["setShared"]>(
    (attachment, shared) => {
      queryClient.setQueryData(qk.planAttachments(planId), (old: typeof query.data) =>
        old
          ? {
              ...old,
              attachments: old.attachments.map((a) =>
                a.id === attachment.id ? { ...a, shared_with_agents: shared } : a,
              ),
            }
          : old,
      );
      shareFn({ data: { attachmentId: attachment.id, shared } })
        .then(() => toast.success(shared ? "Shared with agents" : "Hidden from agents"))
        .catch((error) =>
          toast.error(toUserMessage(error, "Couldn't change who can see that file.")),
        )
        .finally(() => void refreshFiles());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query.data is read through the updater
    [queryClient, planId, shareFn, refreshFiles],
  );

  const download = useCallback<PlanMediaValue["download"]>(
    (attachment) => {
      signFn({ data: { attachmentId: attachment.id } })
        .then(({ url }) => {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = attachment.file_name;
          anchor.rel = "noreferrer";
          anchor.click();
        })
        .catch((error) => toast.error(toUserMessage(error, "Couldn't download that file.")));
    },
    [signFn],
  );

  const lookup = useCallback((id: string) => all.find((a) => a.id === id), [all]);

  const value = useMemo<PlanMediaValue>(
    () => ({
      visible,
      byTask,
      lookup,
      uploads,
      upload,
      dismissUpload: dismiss,
      remove,
      setShared,
      download,
      isLoading: query.isPending,
    }),
    [
      visible,
      byTask,
      lookup,
      uploads,
      upload,
      dismiss,
      remove,
      setShared,
      download,
      query.isPending,
    ],
  );

  return <PlanMediaContext.Provider value={value}>{children}</PlanMediaContext.Provider>;
}
