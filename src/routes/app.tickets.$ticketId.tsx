import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { SectionBoundary } from "@/components/error-boundary";
import { RichTextEditor } from "@/components/rich-text-editor";
import { RichTextView } from "@/components/rich-text-view";
import { useAuth } from "@/components/auth-provider";
import { AttachmentGrid } from "@/features/tickets/attachment-tile";
import { CaptureContextPanel } from "@/features/tickets/capture-context-panel";
import { SlaBadge } from "@/features/tickets/sla-badge";
import { TicketSidebar } from "@/features/tickets/ticket-sidebar";
import { TicketTimeline } from "@/features/tickets/ticket-timeline";
import { CaptureDropzone } from "@/features/capture/capture-dropzone";
import { useServerAction } from "@/lib/use-server-action";
import { addComment } from "@/lib/tickets.functions";
import { draftReply } from "@/lib/ai.functions";
import { useAiEnabled } from "@/hooks/use-ai-enabled";
import { notifyTicketComment } from "@/lib/notifications.functions";
import { describeOutcome, newDraftId, uploadDrafts, type DraftAttachment } from "@/lib/upload";
import { supabase } from "@/integrations/supabase/client";
import {
  ticketAttachmentsQuery,
  ticketCommentsQuery,
  ticketContextQuery,
  ticketEventsQuery,
  ticketQuery,
} from "@/data/tickets";
import { workspacePeopleQuery } from "@/data/projects";
import { qk } from "@/data/keys";
import { ticketOriginSchema } from "@/data/ticket-origin";
import {
  TICKET_PRIORITY_LABEL,
  TICKET_PRIORITY_TONE,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  TICKET_TYPE_LABEL,
} from "@/data/enums";
import { formatDate } from "@/lib/utils-format";
import { toast } from "sonner";
import type { PersonRef, TicketDetail } from "@/data/types";

export const Route = createFileRoute("/app/tickets/$ticketId")({
  validateSearch: ticketOriginSchema,
  component: TicketPage,
});

function plainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function replyDraftKey(ticketId: string) {
  return `cf.reply.draft.${ticketId}`;
}

function TicketBackButton({ isAdmin, projectId }: { isAdmin: boolean; projectId?: string | null }) {
  const router = useRouter();
  const origin = Route.useSearch();

  const fallback =
    origin.from === "project" && (origin.projectId || projectId)
      ? ({
          label: "Project",
          to: "/app/projects/$projectId" as const,
          params: { projectId: origin.projectId ?? projectId! },
          search: { tab: "tickets" as const },
        } as const)
      : origin.from === "inbox"
        ? ({ label: "Inbox", to: "/app/inbox" as const } as const)
        : origin.from === "home"
          ? ({ label: "Home", to: "/app" as const } as const)
          : origin.from === "tickets" || (!isAdmin && origin.from !== "triage")
            ? ({ label: "My tickets", to: "/app/tickets" as const } as const)
            : ({ label: "Triage", to: "/app/triage" as const } as const);

  const className =
    "text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded";

  if (router.history.canGoBack()) {
    return (
      <button type="button" className={className} onClick={() => router.history.back()}>
        ← {fallback.label}
      </button>
    );
  }

  if (fallback.to === "/app/projects/$projectId") {
    return (
      <Link
        to={fallback.to}
        params={fallback.params}
        search={fallback.search}
        className={className}
      >
        ← {fallback.label}
      </Link>
    );
  }

  return (
    <Link to={fallback.to} className={className}>
      ← {fallback.label}
    </Link>
  );
}

function TicketPage() {
  const { ticketId } = Route.useParams();
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const ticket = useQuery(ticketQuery(ticketId));
  const comments = useQuery(ticketCommentsQuery(ticketId));
  const events = useQuery(ticketEventsQuery(ticketId));
  const attachments = useQuery(ticketAttachmentsQuery(ticketId));
  const context = useQuery({ ...ticketContextQuery(ticketId), enabled: isAdmin });

  // Realtime finally works: the tables are in the publication, and the socket's
  // token is re-armed on refresh by the auth provider.
  useEffect(() => {
    const channel = supabase
      .channel(`ticket:${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ticket_comments",
          filter: `ticket_id=eq.${ticketId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: qk.ticketComments(ticketId) }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ticket_events",
          filter: `ticket_id=eq.${ticketId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: qk.ticketEvents(ticketId) }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets", filter: `id=eq.${ticketId}` },
        () => void queryClient.invalidateQueries({ queryKey: qk.ticket(ticketId) }),
      )
      .subscribe();

    return () => void supabase.removeChannel(channel);
  }, [ticketId, queryClient]);

  return (
    <QueryState query={ticket} errorTitle="Couldn't load this ticket">
      {(t) => (
        <div className="mx-auto max-w-[1120px] px-4 pb-16 pt-6 md:px-8">
          <TicketBackButton isAdmin={isAdmin} projectId={t.project_id} />

          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-muted-foreground">#{t.ticket_number}</span>
            <StatusPill tone={TICKET_STATUS_TONE[t.status]}>
              {TICKET_STATUS_LABEL[t.status]}
            </StatusPill>
            <StatusPill tone={TICKET_PRIORITY_TONE[t.priority]}>
              {TICKET_PRIORITY_LABEL[t.priority]}
            </StatusPill>
            <SlaBadge dueAt={t.sla_due_at} status={t.status} showOk />
            <span className="text-xs text-muted-foreground">
              {TICKET_TYPE_LABEL[t.type]}
              {t.project ? (
                <>
                  {" · "}
                  <Link
                    to="/app/projects/$projectId"
                    params={{ projectId: t.project.id }}
                    search={{ tab: "tickets" }}
                    className="underline-offset-2 hover:underline"
                  >
                    {t.project.title}
                  </Link>
                </>
              ) : null}
            </span>
          </div>
          <h1 className="mt-2.5 max-w-[820px] font-display text-[38px] font-normal leading-[1.15]">
            {t.title}
          </h1>

          <div className="mt-7 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-8">
              <section aria-labelledby="sent">
                <h2 id="sent" className="mb-2.5 font-display text-2xl font-normal">
                  What they sent
                </h2>
                <div className="rounded-xl border bg-card px-5 py-[18px] leading-relaxed">
                  <div className="mb-2 text-[13px] text-muted-foreground">
                    {t.reporter?.full_name ?? t.reporter?.email ?? "Someone"}
                  </div>
                  {t.description ? (
                    <RichTextView html={t.description} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No description.</p>
                  )}

                  {t.eta_date && (
                    <p className="mt-4 flex items-center gap-1.5 rounded-md bg-accent/40 p-2.5 text-sm">
                      <CalendarClock className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      We&rsquo;re aiming to have this done by{" "}
                      <strong>{formatDate(t.eta_date)}</strong>.
                    </p>
                  )}

                  {(attachments.data?.length ?? 0) > 0 && (
                    <SectionBoundary label="attachments">
                      <div className="mt-4">
                        <AttachmentGrid attachments={attachments.data ?? []} />
                      </div>
                    </SectionBoundary>
                  )}
                </div>
              </section>

              {isAdmin && context.data && (
                <SectionBoundary label="capture-context">
                  <CaptureContextPanel context={context.data} />
                </SectionBoundary>
              )}

              {isAdmin && t.ai_summary && (
                <Card className="bg-accent/40 p-4 shadow-none sm:p-5">
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                    Summary
                  </h2>
                  <p className="whitespace-pre-wrap text-sm">{t.ai_summary}</p>
                </Card>
              )}

              <section className="space-y-3.5" aria-labelledby="conversation">
                <h2 id="conversation" className="font-display text-[26px] font-normal">
                  Conversation
                </h2>
                <SectionBoundary label="timeline">
                  <TicketTimeline
                    comments={comments.data ?? []}
                    events={events.data ?? []}
                    showInternal={isAdmin}
                    reporterId={t.reporter_id}
                  />
                </SectionBoundary>
                {user && <CommentBox ticketId={ticketId} userId={user.id} isAdmin={isAdmin} />}
              </section>
            </div>

            <aside>
              <SectionBoundary label="ticket-sidebar">
                {isAdmin && user ? (
                  <TicketSidebar ticket={t} userId={user.id} />
                ) : (
                  <ClientProperties ticket={t} />
                )}
              </SectionBoundary>
            </aside>
          </div>
        </div>
      )}
    </QueryState>
  );
}

/** What a client can see about their ticket. Read-only: only the agency changes these. */
function ClientProperties({ ticket: t }: { ticket: TicketDetail }) {
  const rows: Array<[string, React.ReactNode]> = [
    [
      "Status",
      <StatusPill key="s" tone={TICKET_STATUS_TONE[t.status]}>
        {TICKET_STATUS_LABEL[t.status]}
      </StatusPill>,
    ],
    [
      "Priority",
      <StatusPill key="p" tone={TICKET_PRIORITY_TONE[t.priority]}>
        {TICKET_PRIORITY_LABEL[t.priority]}
      </StatusPill>,
    ],
    ["Project", t.project?.title ?? "—"],
    ["Reporter", t.reporter?.full_name ?? t.reporter?.email ?? "—"],
    ["ETA", t.eta_date ? formatDate(t.eta_date) : "Not set yet"],
  ];
  return (
    <Card className="space-y-4 rounded-xl bg-surface p-[18px] shadow-none">
      <dl className="space-y-2.5 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center gap-3">
            <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      {t.labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {t.labels.map((label) => (
            <StatusPill key={label}>{label}</StatusPill>
          ))}
        </div>
      )}
    </Card>
  );
}

function CommentBox({
  ticketId,
  userId,
  isAdmin,
}: {
  ticketId: string;
  userId: string;
  isAdmin: boolean;
}) {
  const { workspaceId } = useAuth();
  const aiEnabled = useAiEnabled();
  const [body, setBody] = useState(() => {
    try {
      return sessionStorage.getItem(replyDraftKey(ticketId)) ?? "";
    } catch {
      return "";
    }
  });
  const [internal, setInternal] = useState(false);
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const mentionBoxRef = useRef<HTMLDivElement>(null);

  const people = useQuery(workspacePeopleQuery(workspaceId));

  useEffect(() => {
    try {
      if (body.trim()) sessionStorage.setItem(replyDraftKey(ticketId), body);
      else sessionStorage.removeItem(replyDraftKey(ticketId));
    } catch {
      /* ignore */
    }
  }, [body, ticketId]);

  useEffect(() => {
    const text = plainText(body);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(text.replace(/\u00a0/g, " "));
    setMentionQuery(match ? match[1] : null);
  }, [body]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return (people.data ?? [])
      .filter((person) => person.id !== userId)
      .filter((person) => {
        const name = (person.full_name ?? person.email ?? "").toLowerCase();
        return !q || name.includes(q) || (person.email ?? "").toLowerCase().includes(q);
      })
      .slice(0, 6);
  }, [mentionQuery, people.data, userId]);

  const notify = useServerFn(notifyTicketComment);

  const post = useServerAction(useServerFn(addComment), {
    label: "tickets.addComment",
    invalidate: [qk.ticket(ticketId), qk.tickets()],
  });

  const draft = useServerAction(useServerFn(draftReply), {
    label: "ai.draftReply",
    errorMessage: "Couldn't draft a reply.",
    onSuccess: (result) =>
      setBody((current) => (current ? `${current}<p></p>` : "") + `<p>${result.reply}</p>`),
  });

  const insertMention = (person: PersonRef) => {
    const label = person.full_name ?? person.email ?? "someone";
    const text = plainText(body);
    const nextText = text.replace(
      /(?:^|\s)@[^\s@]*$/,
      (m) => `${m[0] === "@" ? "" : m[0]}@${label} `,
    );
    setBody(`<p>${nextText.replace(/\n/g, "<br>")}</p>`);
    setMentions((prev) => (prev.includes(person.id) ? prev : [...prev, person.id]));
    setMentionQuery(null);
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = plainText(body);
    if (!text && drafts.length === 0) return;

    if (text) {
      await post.run({
        ticketId,
        body: body.trim(),
        isInternal: internal,
        mentions,
      });
    }

    if (drafts.length > 0) {
      setUploading(true);
      const outcome = await uploadDrafts(ticketId, userId, drafts);
      setUploading(false);
      const problem = describeOutcome(outcome);
      if (problem) toast.error(problem);
    }

    if (!internal && text) {
      void notify({
        data: { ticketId, excerpt: text.slice(0, 200), mentions },
      }).catch(() => {});
    }

    setBody("");
    setDrafts([]);
    setInternal(false);
    setMentions([]);
    try {
      sessionStorage.removeItem(replyDraftKey(ticketId));
    } catch {
      /* ignore */
    }
  };

  const busy = post.busy || uploading;
  const placeholder = useMemo(
    () =>
      isAdmin ? "Reply to the client… Type @ to mention" : "Add anything else that might help…",
    [isAdmin],
  );

  return (
    <form
      onSubmit={send}
      className={`space-y-3 rounded-xl border p-3 transition-colors ${
        internal ? "border-warning/40 bg-warning/10" : "bg-card"
      }`}
    >
      <div className="relative space-y-1.5" ref={mentionBoxRef}>
        <Label htmlFor="reply" className="sr-only">
          Your reply
        </Label>
        <RichTextEditor id="reply" value={body} onChange={setBody} placeholder={placeholder} />
        {mentionCandidates.length > 0 && (
          <ul
            className="absolute bottom-full z-20 mb-1 max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
            role="listbox"
          >
            {mentionCandidates.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => insertMention(person)}
                >
                  <span className="truncate font-medium">{person.full_name ?? person.email}</span>
                  {person.full_name && person.email && (
                    <span className="truncate text-xs text-muted-foreground">{person.email}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CaptureDropzone
        drafts={drafts}
        onAdd={(files) =>
          setDrafts((prev) => [
            ...prev,
            ...files.map<DraftAttachment>((file) => ({
              id: newDraftId(),
              file,
              bucket: file.type.startsWith("video/") ? "recordings" : "attachments",
              kind: file.type.startsWith("image/") ? "image" : "file",
            })),
          ])
        }
        onRemove={(id) => setDrafts((prev) => prev.filter((d) => d.id !== id))}
        label="Attach something"
      />

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && aiEnabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={draft.busy}
            onClick={() => draft.fire({ ticketId })}
          >
            {draft.busy ? "Drafting…" : "Draft with AI"}
          </Button>
        )}
        {isAdmin && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={internal}
            className={`h-8 text-xs ${internal ? "border-warning/50 bg-warning/20" : ""}`}
            onClick={() => setInternal((value) => !value)}
          >
            Internal note
          </Button>
        )}
        <span className="flex-1" />
        <Button type="submit" disabled={busy || (!plainText(body) && drafts.length === 0)}>
          {busy ? "Sending…" : internal ? "Add note" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
