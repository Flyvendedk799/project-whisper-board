import { useMemo, useState } from "react";
import type { PlanAttachmentWithUrl, PlanWithSections } from "@/data";
import { cn } from "@/lib/utils";
import { AttachmentLightbox } from "./attachment-lightbox";
import { AttachmentTile, UploadTile } from "./attachment-tile";
import { FileDropzone } from "./file-dropzone";
import { usePlanMedia } from "./plan-media";
import {
  matchesFileKind,
  matchesFilters,
  sortedTasks,
  taskHeadline,
  type FileKindFilter,
  type TaskFilters,
} from "./plan-model";

const KINDS: Array<[FileKindFilter, string]> = [
  ["all", "All"],
  ["image", "Images"],
  ["video", "Video"],
  ["docs", "Documents"],
];

/** Every file on the plan: its own first, then each task's, filterable by type. */
export function PlanFilesView({
  plan,
  filters,
  meId,
  kind,
  onKind,
  onOpenTask,
}: {
  plan: PlanWithSections;
  filters: TaskFilters;
  meId?: string | null;
  kind: FileKindFilter;
  onKind: (kind: FileKindFilter) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const media = usePlanMedia();
  const [openId, setOpenId] = useState<string | null>(null);

  const { planFiles, groups, flat } = useMemo(() => {
    const planFiles = media.planFiles.filter((file) => matchesFileKind(file.mime_type, kind));
    const groups: Array<{
      task: PlanWithSections["sections"][number]["tasks"][number];
      section: string;
      files: PlanAttachmentWithUrl[];
    }> = [];
    for (const section of plan.sections) {
      for (const task of sortedTasks(section.tasks ?? [])) {
        if (!matchesFilters(task, filters, meId)) continue;
        const files = (media.byTask.get(task.id) ?? []).filter((file) =>
          matchesFileKind(file.mime_type, kind),
        );
        if (files.length > 0) groups.push({ task, section: section.title, files });
      }
    }
    return { planFiles, groups, flat: [...planFiles, ...groups.flatMap((group) => group.files)] };
  }, [plan.sections, filters, meId, media.byTask, media.planFiles, kind]);
  const planUploads = media.uploads.filter((u) => u.taskId === null);

  const taskTitleOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of plan.sections)
      for (const task of section.tasks ?? []) map.set(task.id, task.title);
    return map;
  }, [plan.sections]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-4 py-5 md:px-8 md:pb-10">
      <div className="no-scrollbar flex flex-wrap items-center gap-2 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4">
        {KINDS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => onKind(value)}
            className={cn(
              "h-[30px] rounded-full border px-3.5 text-[13px] max-md:h-10 max-md:shrink-0 max-md:whitespace-nowrap",
              kind === value ? "border-primary bg-accent" : "bg-card hover:bg-muted/60",
            )}
          >
            {label}
          </button>
        ))}
        <span className="flex-1 max-md:hidden" />
        <span className="text-xs text-muted-foreground max-md:hidden">
          Files on the plan itself, then everything attached to its tasks.
        </span>
      </div>

      <section className="flex flex-col gap-2.5" aria-labelledby="plan-files">
        <div className="flex items-baseline gap-2.5 max-md:flex-col max-md:gap-0.5">
          <h2 id="plan-files" className="font-display text-xl">
            Plan files
          </h2>
          <span className="text-xs text-muted-foreground">
            For the whole plan, not one task. Shared files are included in every agent&rsquo;s
            context.
          </span>
        </div>
        <FileDropzone
          onFiles={(picked) => void media.upload(null, picked)}
          prompt="or drop them here"
          ariaLabel="Attach files to the plan"
        />
        {planFiles.length > 0 || planUploads.length > 0 ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5 max-md:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] max-md:gap-3">
            {planFiles.map((file) => (
              <li key={file.id}>
                <AttachmentTile roomy attachment={file} onOpen={() => setOpenId(file.id)} />
              </li>
            ))}
            {planUploads.map((item) => (
              <li key={item.id}>
                <UploadTile item={item} onDismiss={() => media.dismissUpload(item.id)} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {flat.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          {media.isLoading
            ? "Loading files…"
            : "No files match. Drop files onto a card or open a task to attach some."}
        </div>
      ) : null}

      {groups.map(({ task, section, files }) => (
        <section key={task.id} className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2.5 max-md:flex-col max-md:gap-0">
            <button
              type="button"
              onClick={() => onOpenTask(task.id)}
              className="text-left font-display text-xl hover:text-primary max-md:-my-1 max-md:min-h-11 max-md:py-2"
            >
              {taskHeadline(task.title)}
            </button>
            <span className="text-xs text-muted-foreground">{section}</span>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5 max-md:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] max-md:gap-3">
            {files.map((file) => (
              <li key={file.id}>
                <AttachmentTile roomy attachment={file} onOpen={() => setOpenId(file.id)} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <AttachmentLightbox
        items={flat}
        openId={openId}
        onOpenChange={setOpenId}
        contextFor={(file) =>
          file.task_id ? taskHeadline(taskTitleOf.get(file.task_id) ?? "") : "Plan files"
        }
      />
    </div>
  );
}
