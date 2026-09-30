import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlanSection } from "@/data";
import { cn } from "@/lib/utils";

export const DIALOG_CONTENT = "sm:rounded-2xl";
export const DIALOG_TITLE = "font-display text-[26px] font-normal leading-tight tracking-normal";

/** Title and a section; the quick way to add a task from anywhere. */
export function NewTaskDialog({
  open,
  onOpenChange,
  sections,
  defaultSectionId,
  busy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: PlanSection[];
  defaultSectionId?: string;
  busy: boolean;
  onCreate: (input: { sectionId: string; title: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [sectionId, setSectionId] = useState(defaultSectionId ?? sections[0]?.id ?? "");

  useEffect(() => {
    if (open) {
      setTitle("");
      setSectionId(defaultSectionId ?? sections[0]?.id ?? "");
    }
    // Only reset when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const disabled = busy || !title.trim() || !sectionId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-[460px]", DIALOG_CONTENT)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled) onCreate({ sectionId, title: title.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle className={DIALOG_TITLE}>New task</DialogTitle>
            <DialogDescription className="sr-only">
              Give the task a title and a section.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs doing?"
            aria-label="Task title"
            maxLength={200}
            className="h-[42px] text-[15px]"
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-muted-foreground">Section</legend>
            <div className="flex flex-wrap gap-1.5">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-pressed={sectionId === section.id}
                  onClick={() => setSectionId(section.id)}
                  className={cn(
                    "h-[30px] rounded-full border px-3 text-xs",
                    sectionId === section.id
                      ? "border-primary bg-accent"
                      : "bg-card hover:bg-muted/60",
                  )}
                >
                  {section.title}
                </button>
              ))}
            </div>
            {sections.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Add a section first.</p>
            ) : null}
          </fieldset>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              {busy ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Add a section, or rename the one passed as `section`. */
export function SectionDialog({
  open,
  onOpenChange,
  section,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: PlanSection | null;
  busy: boolean;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (open) setTitle(section?.title ?? "");
  }, [open, section]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-[420px]", DIALOG_CONTENT)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() && !busy) onSubmit(title.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle className={DIALOG_TITLE}>
              {section ? "Rename section" : "New section"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Sections are the phases of the plan.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Backlog, Design, Launch"
            aria-label="Section title"
            maxLength={100}
            className="h-[42px] text-[15px]"
          />
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {section ? "Save" : "Add section"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
