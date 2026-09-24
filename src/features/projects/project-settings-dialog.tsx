import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/components/auth-provider";
import { useDataMutation } from "@/lib/use-server-action";
import { updateProject } from "@/data/mutations";
import { qk } from "@/data/keys";
import type { ProjectWithOrg } from "@/data/types";

function dollars(cents: number | null) {
  if (cents == null) return "";
  return String(cents / 100);
}

export function ProjectSettingsDialog({ project }: { project: ProjectWithOrg }) {
  const { workspaceId } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? "");
  const [currency, setCurrency] = useState(project.currency);
  const [budget, setBudget] = useState(dollars(project.budget_cents));
  const [rate, setRate] = useState(dollars(project.hourly_rate_cents));
  const [start, setStart] = useState(project.start_date ?? "");
  const [end, setEnd] = useState(project.end_date ?? "");
  const [amountError, setAmountError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(project.title);
    setDescription(project.description ?? "");
    setCurrency(project.currency);
    setBudget(dollars(project.budget_cents));
    setRate(dollars(project.hourly_rate_cents));
    setStart(project.start_date ?? "");
    setEnd(project.end_date ?? "");
  }, [open, project]);

  const save = useDataMutation("projects.update", updateProject, {
    success: "Project saved",
    invalidate: [qk.project(project.id), qk.projectList(workspaceId ?? undefined)],
    onSuccess: () => setOpen(false),
  });

  const cents = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      throw new Error("invalid");
    }
    return Math.round(Number(trimmed) * 100);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="mr-1.5 h-4 w-4" aria-hidden />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            let budgetCents: number | null;
            let rateCents: number | null;
            try {
              budgetCents = cents(budget);
              rateCents = cents(rate);
            } catch {
              setAmountError("Enter a plain amount like 1500 or 150.50, or leave the field empty.");
              return;
            }
            setAmountError(null);
            save.fire({
              id: project.id,
              patch: {
                title: title.trim(),
                description: description.trim() || null,
                currency: currency.trim().toUpperCase().slice(0, 3) || "USD",
                budget_cents: budgetCents,
                hourly_rate_cents: rateCents,
                start_date: start || null,
                end_date: end || null,
              },
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="project-title">Title</Label>
            <Input
              id="project-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="project-currency">Currency</Label>
              <Input
                id="project-currency"
                value={currency}
                maxLength={3}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-budget">Budget</Label>
              <Input
                id="project-budget"
                inputMode="decimal"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-rate">Hourly rate</Label>
              <Input
                id="project-rate"
                inputMode="decimal"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="project-start">Start</Label>
              <Input
                id="project-start"
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-end">End</Label>
              <Input
                id="project-end"
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </div>
          </div>
          {amountError && <p className="text-sm text-destructive">{amountError}</p>}
          <p className="text-xs text-muted-foreground">
            The hourly rate is copied onto new time entries and used when you bill unbilled time.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={save.busy || !title.trim()}>
              {save.busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
