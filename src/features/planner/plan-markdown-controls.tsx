import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/lib/use-server-action";
import { importPlanMarkdown } from "@/lib/planner.functions";
import {
  parsePlanMarkdown,
  planMarkdownPreview,
  planMarkdownStats,
  planMarkdownStepCount,
  type PlanMdDocument,
  type PlanMdPreviewNode,
} from "@/lib/plan-markdown";
import { qk } from "@/data/keys";
import { cn } from "@/lib/utils";
import { DIALOG_CONTENT, DIALOG_TITLE } from "./plan-dialogs";
import { pluralize } from "./plan-model";

const SAMPLE =
  "# Research\n- Audit support inbox\n- Review competitor flows\n  - [ ] Linear\n  - [ ] Height\n# Build\n- Checklist component\n  - [ ] Four items\n  - [ ] Dismiss state\n- Sample data seeder\n# Launch\n- Announcement post";

function PreviewTree({ nodes, depth = 0 }: { nodes: PlanMdPreviewNode[]; depth?: number }) {
  if (nodes.length === 0) return null;
  return (
    <ul className={depth === 0 ? "flex flex-col gap-2.5" : "mt-0.5 flex flex-col gap-0.5 pl-2.5"}>
      {nodes.map((node, index) => (
        <li key={`${depth}-${index}-${node.title}`}>
          {node.step ? (
            <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden="true">{node.step.done ? "☑" : "☐"}</span>
              <span className={node.step.done ? "line-through" : undefined}>{node.title}</span>
            </span>
          ) : (
            <span
              className={cn(
                depth === 0 ? "text-[13px] font-medium" : "text-[13px] text-foreground/80",
              )}
            >
              {node.title}
              {depth === 0 ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {pluralize(node.children.length, "task")}
                </span>
              ) : null}
            </span>
          )}
          {node.children.length > 0 ? (
            <PreviewTree nodes={node.children} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Paste or choose a Markdown outline, see what it will become, then merge it
 * in or replace the plan. Headings become sections, list items become tasks,
 * and `- [ ]` lines under a task become its sub-steps.
 */
export function ImportMarkdownDialog({
  planId,
  open,
  onOpenChange,
}: {
  planId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [markdown, setMarkdown] = useState("");
  const [fileName, setFileName] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  const doc: PlanMdDocument = useMemo(() => parsePlanMarkdown(markdown), [markdown]);
  const stats = planMarkdownStats(doc);
  const steps = planMarkdownStepCount(doc);
  const preview = useMemo(() => planMarkdownPreview(doc), [doc]);
  const empty = stats.sections === 0;

  const reset = () => {
    setMarkdown("");
    setFileName("");
    setConfirmReplace(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const importMd = useServerAction(useServerFn(importPlanMarkdown), {
    label: "plans.importMarkdown",
    success: (result) => {
      const parts = `${pluralize(result.sections, "section")}, ${pluralize(result.tasks, "task")}${
        result.steps ? ` and ${pluralize(result.steps, "sub-step")}` : ""
      }`;
      const lost = result.coverage.missing
        ? `. ${pluralize(result.coverage.missing, "line")} of your document could not be placed.`
        : "";
      if (result.mode === "sync") {
        const kept = result.sync
          ? `, ${pluralize(result.sync.matchedTasks, "existing task")} kept as they were`
          : "";
        return `Synced: added ${parts}${kept}${lost}`;
      }
      return `${result.mode === "replace" ? "Replaced plan with" : "Merged"} ${parts}${lost}`;
    },
    invalidate: [qk.plan(planId), qk.planEvents(planId), qk.planAttachments(planId)],
    onSuccess: () => {
      onOpenChange(false);
      reset();
    },
  });

  const pickFile = async (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md") && file.type !== "text/markdown") {
      toast.error("Choose a .md markdown file.");
      return;
    }
    setMarkdown(await file.text());
    setFileName(file.name);
  };

  const hint = markdown.trim()
    ? "No sections found. Use headings (# / ##), a numbered outline (1 / 1.1), or a nested list."
    : "A preview of sections and tasks appears here.";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) reset();
        }}
      >
        <DialogContent className={cn("max-w-[720px]", DIALOG_CONTENT)}>
          <DialogHeader>
            <DialogTitle className={DIALOG_TITLE}>Import Markdown</DialogTitle>
            <DialogDescription>
              Headings become sections, list items become tasks, and <code>- [ ]</code> lines become
              sub-steps.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".md,text/markdown"
              className="sr-only"
              aria-label="Choose a Markdown file"
              onChange={(event) => void pickFile(event.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              Choose .md file
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-primary"
              onClick={() => {
                setMarkdown(SAMPLE);
                setFileName("sample-outline.md");
              }}
            >
              Use sample outline
            </Button>
            <span className="flex-1" />
            <span className="truncate text-xs text-muted-foreground">{fileName}</span>
          </div>

          <div className="grid min-h-[260px] gap-3.5 md:grid-cols-2">
            <Textarea
              value={markdown}
              onChange={(event) => {
                setMarkdown(event.target.value);
                setFileName("");
              }}
              aria-label="Markdown outline"
              placeholder="Or paste an outline here"
              className="min-h-[260px] resize-none rounded-[10px] bg-background font-mono text-xs leading-relaxed"
            />
            <div
              className="max-h-[340px] overflow-auto rounded-[10px] border p-3"
              aria-label="Preview"
              aria-live="polite"
            >
              {empty ? (
                <p className="text-[13px] text-muted-foreground">{hint}</p>
              ) : (
                <PreviewTree nodes={preview} />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-[200px] flex-1 text-xs leading-snug text-muted-foreground">
              {empty
                ? "Sync adds what is missing and keeps all progress. Merge adds every section as new. Replace deletes all current sections and tasks first."
                : `${pluralize(stats.sections, "section")}, ${pluralize(stats.tasks, "task")}${
                    steps ? `, ${pluralize(steps, "sub-step")}` : ""
                  }. Sync matches by title, adds what is missing and keeps all progress. Merge adds every section as new. Replace deletes all current sections and tasks first.`}
            </p>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={empty || importMd.busy}
              onClick={() => importMd.fire({ planId, markdown, mode: "sync" })}
            >
              {importMd.busy ? "Importing…" : "Sync"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={empty || importMd.busy}
              onClick={() => importMd.fire({ planId, markdown, mode: "merge" })}
            >
              Merge
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={empty || importMd.busy}
              onClick={() => setConfirmReplace(true)}
            >
              Replace
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className={DIALOG_TITLE}>Replace this plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Every current section, task, note and file is deleted, then the plan is filled from
              this outline. This can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the plan</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => importMd.fire({ planId, markdown, mode: "replace" })}
            >
              Replace plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
