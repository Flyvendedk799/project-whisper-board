import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { ColorPicker } from "./color-picker";
import { TagEditor } from "./tag-editor";

export const DIALOG_CONTENT = "md:rounded-2xl";
/**
 * Phones: the action row of a long form stays pinned to the bottom edge of the sheet, over the
 * sheet's own padding, so Save is always one thumb tap away.
 */
export const STICKY_ACTIONS =
  "max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-5 max-md:-mb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] max-md:border-t max-md:bg-background/95 max-md:px-5 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] max-md:pt-3 max-md:backdrop-blur";

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
            enterKeyHint="done"
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
                    "h-[30px] max-w-full truncate rounded-full border px-3 text-xs max-md:h-10 max-md:px-3.5 max-md:text-sm",
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
          <DialogFooter className={cn("gap-2 sm:space-x-0", STICKY_ACTIONS)}>
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

export type SectionValues = {
  title: string;
  description: string;
  goals: string;
  intentions: string;
  /** The client layer: a short plain-language summary, in Danish. */
  clientSummary: string;
  color: string | null;
  tags: string[];
};

/**
 * Add a section, or edit the one passed as `section`. A section is more than a
 * column title: it says what the phase is for (description), what it should
 * achieve (goals) and why it exists (intentions), and agents read all three.
 */
export function SectionDialog({
  open,
  onOpenChange,
  section,
  busy,
  tagSuggestions = [],
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: PlanSection | null;
  busy: boolean;
  tagSuggestions?: readonly string[];
  onSubmit: (values: SectionValues) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goals, setGoals] = useState("");
  const [intentions, setIntentions] = useState("");
  const [clientSummary, setClientSummary] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTitle(section?.title ?? "");
    setDescription(section?.description ?? "");
    setGoals(section?.goals ?? "");
    setIntentions(section?.intentions ?? "");
    setClientSummary(section?.client_summary ?? "");
    setColor(section?.color ?? null);
    setTags(section?.tags ?? []);
  }, [open, section]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90vh] max-w-[560px] overflow-auto", DIALOG_CONTENT)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() && !busy) {
              onSubmit({
                title: title.trim(),
                description: description.trim(),
                goals: goals.trim(),
                intentions: intentions.trim(),
                clientSummary: clientSummary.trim(),
                color,
                tags,
              });
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className={DIALOG_TITLE}>
              {section ? "Edit section" : "New section"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Sections are the phases of the plan. Describe what each one is for.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Backlog, Design, Launch"
            aria-label="Section title"
            maxLength={100}
            enterKeyHint="next"
            className="h-[42px] text-[15px]"
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="section-description" className="text-xs text-muted-foreground">
              Description
            </Label>
            <Textarea
              id="section-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this part of the plan covers."
              rows={3}
              className="resize-y text-sm"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="section-goals" className="text-xs text-muted-foreground">
                Goals
              </Label>
              <Textarea
                id="section-goals"
                value={goals}
                onChange={(event) => setGoals(event.target.value)}
                placeholder="What should be true when it is done?"
                rows={3}
                className="resize-y text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="section-intentions" className="text-xs text-muted-foreground">
                Intentions
              </Label>
              <Textarea
                id="section-intentions"
                value={intentions}
                onChange={(event) => setIntentions(event.target.value)}
                placeholder="Why it exists, and how to approach it."
                rows={3}
                className="resize-y text-sm"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5 rounded-xl border border-dashed p-3">
            <Label htmlFor="section-client-summary" className="text-xs text-muted-foreground">
              Client summary (Danish)
            </Label>
            <Textarea
              id="section-client-summary"
              value={clientSummary}
              onChange={(event) => setClientSummary(event.target.value)}
              placeholder="Kort og letforståeligt: hvad sker der her, og hvor er vi? Det her ser kunden."
              rows={3}
              maxLength={2000}
              className="resize-y text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              The only part of this section clients on a shared plan see, with its progress. The
              fields above stay with you and your agents.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Colour</span>
            <ColorPicker label="Section colour" value={color} onChange={setColor} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Tags</span>
            <TagEditor
              label="Section tags"
              tags={tags}
              suggestions={tagSuggestions}
              onChange={setTags}
            />
          </div>
          <DialogFooter className={cn("gap-2 sm:space-x-0", STICKY_ACTIONS)}>
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
