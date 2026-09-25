import { useId, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useServerAction } from "@/lib/use-server-action";
import { importPlanMarkdown } from "@/lib/planner.functions";
import {
  parsePlanMarkdown,
  planMarkdownFilename,
  planMarkdownPreview,
  planMarkdownStats,
  serializePlanMarkdown,
  type PlanMdDocument,
  type PlanMdPreviewNode,
} from "@/lib/plan-markdown";
import { qk } from "@/data/keys";
import type { PlanWithSections } from "@/data";

function PreviewTree({ nodes, depth = 0 }: { nodes: PlanMdPreviewNode[]; depth?: number }) {
  if (nodes.length === 0) return null;
  return (
    <ul className={depth === 0 ? "space-y-2" : "mt-1 space-y-1 border-l pl-3"}>
      {nodes.map((node, index) => (
        <li key={`${depth}-${index}-${node.title}`}>
          <span className={depth === 0 ? "font-medium text-foreground" : "text-sm text-foreground"}>
            {node.title}
          </span>
          {node.children.length > 0 ? (
            <PreviewTree nodes={node.children} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ImportMarkdownButton({ planId }: { planId: string }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [doc, setDoc] = useState<PlanMdDocument | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const importMd = useServerAction(useServerFn(importPlanMarkdown), {
    label: "plans.importMarkdown",
    success: (result) =>
      result.mode === "replace"
        ? `Replaced plan with ${result.sections} section${result.sections === 1 ? "" : "s"} and ${result.tasks} task${result.tasks === 1 ? "" : "s"}`
        : `Merged ${result.sections} section${result.sections === 1 ? "" : "s"} and ${result.tasks} task${result.tasks === 1 ? "" : "s"}`,
    invalidate: [qk.plan(planId)],
    onSuccess: () => {
      setOpen(false);
      resetPicker();
    },
  });

  function resetPicker() {
    setFileName(null);
    setDoc(null);
    setMarkdown("");
    setParseError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onFileChange(file: File | null) {
    if (!file) {
      resetPicker();
      return;
    }
    if (!file.name.toLowerCase().endsWith(".md") && file.type !== "text/markdown") {
      setFileName(file.name);
      setDoc(null);
      setMarkdown("");
      setParseError("Choose a .md markdown file.");
      setOpen(true);
      return;
    }

    const text = await file.text();
    const parsed = parsePlanMarkdown(text);
    const stats = planMarkdownStats(parsed);
    setFileName(file.name);
    setMarkdown(text);
    if (stats.sections === 0) {
      setDoc(null);
      setParseError(
        "No sections found. Use a numbered outline (1 / 1.1), headings (# / ##), or a nested list.",
      );
      setOpen(true);
      return;
    }
    setParseError(null);
    setDoc(parsed);
    setOpen(true);
  }

  const stats = doc ? planMarkdownStats(doc) : null;
  const preview = doc ? planMarkdownPreview(doc) : [];

  return (
    <>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept=".md,text/markdown"
        className="sr-only"
        onChange={(event) => {
          void onFileChange(event.target.files?.[0] ?? null);
        }}
      />
      <Button
        variant="outline"
        size="sm"
        type="button"
        disabled={importMd.busy}
        onClick={() => inputRef.current?.click()}
      >
        <FileUp className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Import Markdown
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) resetPicker();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Markdown</DialogTitle>
            <DialogDescription>
              {fileName ? (
                <>
                  Preview of <span className="font-medium text-foreground">{fileName}</span>
                  {stats
                    ? ` — ${stats.sections} section${stats.sections === 1 ? "" : "s"}, ${stats.tasks} task${stats.tasks === 1 ? "" : "s"}`
                    : null}
                  .
                </>
              ) : (
                "Choose a markdown outline to layer onto this plan."
              )}
            </DialogDescription>
          </DialogHeader>

          {parseError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {parseError}
            </p>
          ) : null}

          {doc && !parseError ? (
            <ScrollArea className="max-h-72 rounded-md border p-3">
              <PreviewTree nodes={preview} />
            </ScrollArea>
          ) : null}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={importMd.busy || !doc}
              onClick={() => importMd.fire({ planId, markdown, mode: "merge" })}
            >
              {importMd.busy ? "Importing…" : "Merge"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={importMd.busy || !doc}
              onClick={() => importMd.fire({ planId, markdown, mode: "replace" })}
            >
              {importMd.busy ? "Importing…" : "Replace"}
            </Button>
          </DialogFooter>
          <p className="text-xs text-muted-foreground">
            Replace wipes this plan&apos;s sections and tasks, then fills from the file. Merge
            appends new sections at the end.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ExportMarkdownButton({ plan }: { plan: PlanWithSections }) {
  const sections = plan.sections ?? [];
  const empty = sections.length === 0;

  function onExport() {
    const doc: PlanMdDocument = {
      sections: sections.map((section) => ({
        title: section.title,
        tasks: (section.tasks ?? []).map((task) => ({
          title: task.title,
          description: task.description ?? "",
        })),
      })),
    };
    const markdown = serializePlanMarkdown(doc);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = planMarkdownFilename(plan.title);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={empty}
      title={empty ? "Add a section before exporting" : "Download this plan as markdown"}
      onClick={onExport}
    >
      <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
      Export Markdown
    </Button>
  );
}
