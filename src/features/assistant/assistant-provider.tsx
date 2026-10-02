/* eslint-disable react-refresh/only-export-components -- provider + hooks share this module */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAiEnabled } from "@/hooks/use-ai-enabled";
import { assistantChat } from "@/lib/ai-planner.functions";
import type { Action } from "@/lib/assistant-actions";
import { PRESETS, type PresetId } from "@/lib/assistant-prompts";
import { toUserMessage } from "@/lib/errors";
import { captureError } from "@/lib/providers";
import { focusFromLocation, type AssistantFocus } from "./focus";
import { useActionExecutor } from "./use-action-executor";

/**
 * One assistant for the whole signed-in app. The floating button opens it for
 * free-text chat; any other button can start a preset in it with `run()`, so
 * "Audit plan" in a menu and "Audit plan" typed in the panel are the same thing.
 *
 * The conversation lives here, in component state, so it survives closing the
 * panel and moving between screens, and goes away with the tab. Nothing is
 * saved on the server except what the person applies.
 */

export type ProposalStatus = "pending" | "applying" | "applied" | "failed" | "dismissed";

export type Proposal = {
  id: string;
  action: Action;
  /** `describeAction`, written on the server with the names the model saw. */
  summary: string;
  status: ProposalStatus;
  error?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** A failed turn: shown to the person, never sent back to the model. */
  failed?: boolean;
  proposals?: Proposal[];
  /** Suggestions the server threw away because they did not check out. */
  dropped?: number;
  /** The plan the proposals belong to, for refreshing it after they are applied. */
  planId?: string | null;
};

export type AssistantRun = {
  preset: PresetId;
  planId?: string | null;
  taskId?: string | null;
  /** Names for the message the person is shown saying; optional. */
  planTitle?: string | null;
  taskTitle?: string | null;
};

export type AssistantApi = {
  /** AI is set up, so the assistant exists. Everything below is a no-op when it is not. */
  enabled: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Opens the panel and starts a preset on this plan and task (or the one on screen). */
  run: (request: AssistantRun) => void;
};

export type AssistantChat = {
  messages: ChatMessage[];
  busy: boolean;
  /** What the assistant is working on: the screen's plan and task unless the person narrowed it. */
  focus: AssistantFocus;
  setFocus: (focus: Partial<AssistantFocus>) => void;
  send: (text: string, opts?: { preset?: PresetId }) => Promise<void>;
  apply: (messageId: string, proposalId: string) => Promise<void>;
  applyAll: (messageId: string) => Promise<void>;
  dismiss: (messageId: string, proposalId: string) => void;
  reset: () => void;
};

const NOOP_API: AssistantApi = {
  enabled: false,
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  run: () => {},
};

const AssistantApiContext = createContext<AssistantApi>(NOOP_API);
const AssistantChatContext = createContext<AssistantChat | null>(null);

/** Open the assistant or start a preset from anywhere inside the app shell. Safe outside it. */
export function useAssistant(): AssistantApi {
  return useContext(AssistantApiContext);
}

export function useAssistantChat(): AssistantChat | null {
  return useContext(AssistantChatContext);
}

let counter = 0;
const uid = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const enabled = useAiEnabled();
  const location = useLocation();
  const executor = useActionExecutor();

  const route = focusFromLocation(location.pathname, location.search);
  const routeKey = `${route.planId}|${route.taskId}|${route.projectId}`;
  const [narrowed, setNarrowed] = useState<{ routeKey: string; focus: AssistantFocus } | null>(
    null,
  );
  // A narrowing belongs to the screen it was made on; moving elsewhere hands focus back to the screen.
  const focus = narrowed?.routeKey === routeKey ? narrowed.focus : route;

  const [isOpen, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const busyRef = useRef(false);

  const commit = useCallback((update: (previous: ChatMessage[]) => ChatMessage[]) => {
    messagesRef.current = update(messagesRef.current);
    setMessages(messagesRef.current);
  }, []);

  const setFocus = useCallback(
    (patch: Partial<AssistantFocus>) => setNarrowed({ routeKey, focus: { ...focus, ...patch } }),
    [routeKey, focus],
  );

  const send = useCallback(
    async (
      text: string,
      opts: { preset?: PresetId; focus?: AssistantFocus } = {},
    ): Promise<void> => {
      const content = text.trim();
      if (!content || busyRef.current) return;
      const at = opts.focus ?? focus;

      commit((previous) => [...previous, { id: uid(), role: "user", content }]);
      busyRef.current = true;
      setBusy(true);
      try {
        const result = await assistantChat({
          data: {
            messages: messagesRef.current
              .filter((message) => !message.failed)
              .map(({ role, content: body }) => ({ role, content: body })),
            context: {
              planId: at.planId ?? undefined,
              taskId: at.taskId ?? undefined,
              projectId: at.projectId ?? undefined,
              preset: opts.preset,
            },
          },
        });
        commit((previous) => [
          ...previous,
          {
            id: uid(),
            role: "assistant",
            content: result.reply,
            dropped: result.dropped,
            planId: at.planId,
            proposals: result.proposals.map((proposal) => ({
              id: uid(),
              action: proposal.action,
              summary: proposal.summary,
              status: "pending" as const,
            })),
          },
        ]);
      } catch (error) {
        captureError(error, { scope: "assistant", label: "assistant.chat" });
        commit((previous) => [
          ...previous,
          {
            id: uid(),
            role: "assistant",
            failed: true,
            content: toUserMessage(error, "The assistant couldn't answer. Try again."),
          },
        ]);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [commit, focus],
  );

  const patchProposal = useCallback(
    (messageId: string, proposalId: string, patch: Partial<Proposal>) =>
      commit((previous) =>
        previous.map((message) =>
          message.id === messageId
            ? {
                ...message,
                proposals: message.proposals?.map((proposal) =>
                  proposal.id === proposalId ? { ...proposal, ...patch } : proposal,
                ),
              }
            : message,
        ),
      ),
    [commit],
  );

  /** Runs one proposal; false when it was not there to run or did not succeed. */
  const applyOne = useCallback(
    async (messageId: string, proposalId: string): Promise<boolean> => {
      const proposal = messagesRef.current
        .find((message) => message.id === messageId)
        ?.proposals?.find((entry) => entry.id === proposalId);
      if (!proposal || (proposal.status !== "pending" && proposal.status !== "failed"))
        return false;

      patchProposal(messageId, proposalId, { status: "applying", error: undefined });
      try {
        await executor.execute(proposal.action);
        patchProposal(messageId, proposalId, { status: "applied" });
        return true;
      } catch (error) {
        captureError(error, {
          scope: "assistant",
          label: `assistant.apply.${proposal.action.type}`,
        });
        patchProposal(messageId, proposalId, {
          status: "failed",
          error: toUserMessage(error, "That change couldn't be made."),
        });
        return false;
      }
    },
    [executor, patchProposal],
  );

  const planOf = (messageId: string) =>
    messagesRef.current.find((message) => message.id === messageId)?.planId ?? null;

  const apply = useCallback(
    async (messageId: string, proposalId: string) => {
      await applyOne(messageId, proposalId);
      await executor.refresh(planOf(messageId));
    },
    [applyOne, executor],
  );

  const applyAll = useCallback(
    async (messageId: string) => {
      const ids = (messagesRef.current.find((message) => message.id === messageId)?.proposals ?? [])
        .filter((proposal) => proposal.status === "pending" || proposal.status === "failed")
        .map((proposal) => proposal.id);
      let applied = 0;
      for (const id of ids) if (await applyOne(messageId, id)) applied++;
      await executor.refresh(planOf(messageId));
      if (applied < ids.length) {
        toast.error(`${ids.length - applied} of ${ids.length} changes didn't go through.`);
      } else if (ids.length > 0) {
        toast.success(`Applied ${applied} change${applied === 1 ? "" : "s"}.`);
      }
    },
    [applyOne, executor],
  );

  const dismiss = useCallback(
    (messageId: string, proposalId: string) =>
      patchProposal(messageId, proposalId, { status: "dismissed" }),
    [patchProposal],
  );

  const reset = useCallback(() => commit(() => []), [commit]);

  const run = useCallback(
    (request: AssistantRun) => {
      if (!enabled) return;
      setOpen(true);
      if (busyRef.current) {
        toast.info("The assistant is still answering. Try again in a moment.");
        return;
      }
      const preset = PRESETS[request.preset];
      const next: AssistantFocus = {
        planId: request.planId ?? focus.planId,
        // A plan-level preset is about the plan, whichever task happens to be open.
        taskId: preset.scope === "task" ? (request.taskId ?? focus.taskId) : null,
        projectId: focus.projectId,
      };
      setNarrowed({ routeKey, focus: next });
      void send(preset.message({ plan: request.planTitle, task: request.taskTitle }), {
        preset: request.preset,
        focus: next,
      });
    },
    [enabled, focus, routeKey, send],
  );

  const api = useMemo<AssistantApi>(
    () => ({
      enabled,
      isOpen,
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen((value) => !value),
      run,
    }),
    [enabled, isOpen, run],
  );

  const chat = useMemo<AssistantChat>(
    () => ({
      messages,
      busy,
      focus,
      setFocus,
      send: (text, opts) => send(text, opts),
      apply,
      applyAll,
      dismiss,
      reset,
    }),
    [messages, busy, focus, setFocus, send, apply, applyAll, dismiss, reset],
  );

  return (
    <AssistantApiContext.Provider value={api}>
      <AssistantChatContext.Provider value={chat}>{children}</AssistantChatContext.Provider>
    </AssistantApiContext.Provider>
  );
}
