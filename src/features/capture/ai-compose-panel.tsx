import { Check, Sparkles, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/app-shell";
import { TICKET_PRIORITY_LABEL, TICKET_TYPE_LABEL } from "@/data/enums";
import type { TicketPriority, TicketType } from "@/data/enums";

/**
 * What the AI made of the capture, offered rather than applied.
 *
 * The client stays the author: every field has its own "Use", the text is
 * editable afterwards, and nothing is filled in until they say so. The point is
 * to spare a non-technical person from writing repro steps, not to file
 * something they never read.
 */

export interface TicketDraft {
  title: string;
  type: TicketType;
  priority: TicketPriority;
  summary: string;
  steps_to_reproduce: string[];
  expected?: string;
  actual?: string;
  confidence: number;
}

export function composeDescription(draft: TicketDraft): string {
  const parts = [draft.summary];
  if (draft.steps_to_reproduce.length) {
    parts.push(
      "",
      "What happened:",
      ...draft.steps_to_reproduce.map((step, i) => `${i + 1}. ${step}`),
    );
  }
  if (draft.expected) parts.push("", `Expected: ${draft.expected}`);
  if (draft.actual) parts.push(`Actually: ${draft.actual}`);
  return parts.join("\n");
}

export function AiComposePanel({
  draft,
  busy,
  onUseAll,
  onUseTitle,
  onUseDescription,
  onRegenerate,
}: {
  draft: TicketDraft;
  busy: boolean;
  onUseAll: () => void;
  onUseTitle: () => void;
  onUseDescription: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-accent/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-medium">Here&rsquo;s a draft from what you sent</h3>
        <StatusPill tone={draft.confidence >= 0.7 ? "success" : "warning"}>
          {draft.confidence >= 0.7 ? "Confident" : "Best guess"}
        </StatusPill>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={onRegenerate}
          disabled={busy}
        >
          <RotateCw
            className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Try again
        </Button>
      </div>

      <Field label="Title" onUse={onUseTitle}>
        <p className="text-sm font-medium">{draft.title}</p>
      </Field>

      <Field label="Description" onUse={onUseDescription}>
        <p className="whitespace-pre-wrap text-sm">{composeDescription(draft)}</p>
      </Field>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Suggested:</span>
        <StatusPill>{TICKET_TYPE_LABEL[draft.type]}</StatusPill>
        <StatusPill>{TICKET_PRIORITY_LABEL[draft.priority]}</StatusPill>
      </div>

      <Button type="button" size="sm" onClick={onUseAll} disabled={busy} className="w-full">
        <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Use all of this
      </Button>
      <p className="text-xs text-muted-foreground">
        You can edit any of it afterwards — nothing is sent until you press Send.
      </p>
    </div>
  );
}

function Field({
  label,
  onUse,
  children,
}: {
  label: string;
  onUse: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onUse}
        >
          Use
        </Button>
      </div>
      {children}
    </div>
  );
}
