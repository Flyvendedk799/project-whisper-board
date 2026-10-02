import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Loader2,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth-provider";
import { planDetailQuery, planListQuery } from "@/data/planner";
import type { PlanWithSections } from "@/data";
import { presetsFor, PRESETS } from "@/lib/assistant-prompts";
import { cn } from "@/lib/utils";
import {
  useAssistant,
  useAssistantChat,
  type ChatMessage,
  type Proposal,
} from "./assistant-provider";

/**
 * The chat panel: free text, preset workflows, and the changes the assistant
 * proposes, each with a plain-language summary and its own Apply. Nothing is
 * changed until the person presses one.
 */
export function AssistantPanel() {
  const { close } = useAssistant();
  const chat = useAssistantChat();
  const { workspaceId } = useAuth();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const focus = chat?.focus;
  const plan = useQuery(planDetailQuery(focus?.planId ?? ""));
  const planData = plan.data?.plan as unknown as PlanWithSections | undefined;
  const planTitle = planData?.title ?? null;
  const taskTitle =
    planData?.sections.flatMap((section) => section.tasks).find((task) => task.id === focus?.taskId)
      ?.title ?? null;
  const plans = useQuery({
    ...planListQuery(workspaceId),
    enabled: Boolean(workspaceId) && !focus?.planId,
  });

  const messageCount = chat?.messages.length ?? 0;
  const busy = chat?.busy ?? false;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messageCount, busy]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  if (!chat || !focus) return null;

  const presets = presetsFor({ plan: Boolean(focus.planId), task: Boolean(focus.taskId) });

  const submit = () => {
    const text = draft.trim();
    if (!text || chat.busy) return;
    setDraft("");
    void chat.send(text);
  };

  return (
    <section
      role="dialog"
      aria-label="Assistant"
      className="fixed bottom-3 left-3 right-3 top-16 z-50 flex flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl md:bottom-20 md:left-auto md:right-5 md:top-auto md:h-[min(38rem,calc(100dvh-7rem))] md:w-[26rem]"
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="font-display text-lg leading-none">Assistant</h2>
        <div className="ml-auto flex items-center gap-1">
          {chat.messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Start a new conversation"
              title="New conversation"
              onClick={chat.reset}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Close assistant"
            onClick={close}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2 text-xs">
        <span className="text-muted-foreground">Working on</span>
        {focus.planId ? (
          <Chip label={planTitle ?? "this plan"} />
        ) : (
          <Select value="" onValueChange={(planId) => chat.setFocus({ planId, taskId: null })}>
            <SelectTrigger
              className="h-7 w-auto min-w-36 max-w-56 text-xs"
              aria-label="Choose a plan"
            >
              <SelectValue placeholder="Everything (pick a plan)" />
            </SelectTrigger>
            <SelectContent>
              {(plans.data?.plans ?? []).map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {focus.taskId && (
          <Chip label={taskTitle ?? "this task"} onClear={() => chat.setFocus({ taskId: null })} />
        )}
      </div>

      <div
        role="log"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {chat.messages.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Ask about your plans and tickets, or have me draft changes. I only propose: nothing
              happens until you apply it.
            </p>
            {presets.length > 0 ? (
              <ul className="grid gap-1.5">
                {presets.map((preset) => (
                  <li key={preset.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() =>
                        void chat.send(
                          PRESETS[preset.id].message({ plan: planTitle, task: taskTitle }),
                          { preset: preset.id },
                        )
                      }
                    >
                      <span className="block font-medium">{preset.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {preset.description}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Open a plan, or pick one above, to use ready-made workflows like Audit and Standup.
              </p>
            )}
          </div>
        ) : (
          chat.messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              onApply={(proposalId) => void chat.apply(message.id, proposalId)}
              onApplyAll={() => void chat.applyAll(message.id)}
              onDismiss={(proposalId) => chat.dismiss(message.id, proposalId)}
            />
          ))
        )}
        {chat.busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Ask or tell me what to do…"
          aria-label="Message the assistant"
          className="max-h-32 min-h-[44px] resize-none"
        />
        <Button
          type="submit"
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={chat.busy || !draft.trim()}
          aria-label="Send"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
    </section>
  );
}

function Chip({ label, onClear }: { label: string; onClear?: () => void }) {
  return (
    <span className="inline-flex max-w-52 items-center gap-1 rounded-full bg-muted px-2 py-0.5">
      <span className="truncate">{label}</span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Stop focusing on ${label}`}
          className="rounded-full text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

function Message({
  message,
  onApply,
  onApplyAll,
  onDismiss,
}: {
  message: ChatMessage;
  onApply: (proposalId: string) => void;
  onApplyAll: () => void;
  onDismiss: (proposalId: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.content}
        </p>
      </div>
    );
  }

  const proposals = message.proposals ?? [];
  const open = proposals.filter((p) => p.status === "pending" || p.status === "failed");
  return (
    <div className="space-y-2">
      <p
        className={cn(
          "max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md px-3 py-2 text-sm",
          message.failed ? "bg-destructive/10 text-destructive" : "bg-muted",
        )}
      >
        {message.failed && (
          <AlertTriangle
            className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom"
            aria-hidden="true"
          />
        )}
        {message.content}
      </p>

      {proposals.length > 0 && (
        <div className="rounded-xl border">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="text-xs font-medium">
              Proposed change{proposals.length === 1 ? "" : "s"} ({proposals.length})
            </span>
            {open.length > 1 && (
              <Button size="sm" className="h-7 px-2.5 text-xs" onClick={onApplyAll}>
                Apply all ({open.length})
              </Button>
            )}
          </div>
          <ul className="divide-y">
            {proposals.map((proposal) => (
              <ProposalRow
                key={proposal.id}
                proposal={proposal}
                onApply={() => onApply(proposal.id)}
                onDismiss={() => onDismiss(proposal.id)}
              />
            ))}
          </ul>
        </div>
      )}
      {(message.dropped ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          {message.dropped} suggestion{message.dropped === 1 ? " was" : "s were"} left out because{" "}
          {message.dropped === 1 ? "it" : "they"} didn&rsquo;t check out against your plan.
        </p>
      )}
    </div>
  );
}

function ProposalRow({
  proposal,
  onApply,
  onDismiss,
}: {
  proposal: Proposal;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const settled = proposal.status === "applied" || proposal.status === "dismissed";
  return (
    <li className="space-y-1.5 px-3 py-2 text-sm">
      <p
        className={cn(
          "break-words",
          proposal.status === "dismissed" && "text-muted-foreground line-through",
        )}
      >
        {proposal.summary}
      </p>
      {proposal.error && <p className="text-xs text-destructive">{proposal.error}</p>}
      <div className="flex items-center gap-2">
        {proposal.status === "applied" && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Applied
          </span>
        )}
        {proposal.status === "applying" && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Applying…
          </span>
        )}
        {proposal.status === "dismissed" && (
          <span className="text-xs text-muted-foreground">Dismissed</span>
        )}
        {!settled && proposal.status !== "applying" && (
          <>
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onApply}>
              {proposal.status === "failed" ? "Retry" : "Apply"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={onDismiss}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
