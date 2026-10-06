import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { SectionBoundary } from "@/components/error-boundary";
import { RichTextEditor } from "@/components/rich-text-editor";
import { RichTextView } from "@/components/rich-text-view";
import { useAuth } from "@/components/auth-provider";
import { AttachmentGrid } from "@/features/tickets/attachment-tile";
import { CaptureContextPanel } from "@/features/tickets/capture-context-panel";
import { SlaBadge } from "@/features/tickets/sla-badge";
import { TicketDeleteDialog } from "@/features/tickets/ticket-delete-dialog";
import { TicketQuickStatus, TicketSidebar } from "@/features/tickets/ticket-sidebar";
import { TicketTimeline } from "@/features/tickets/ticket-timeline";
import { CaptureDropzone } from "@/features/capture/capture-dropzone";
import { useServerAction } from "@/lib/use-server-action";
import { addComment, editOwnTicket } from "@/lib/tickets.functions";
import { draftReply } from "@/lib/ai.functions";
import { useAiEnabled } from "@/hooks/use-ai-enabled";
import { useIsMobile } from "@/hooks/use-mobile";
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
import { projectMembersQuery, workspacePeopleQuery } from "@/data/projects";
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
import type { TicketDetail } from "@/data/types";

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
    "text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded max-md:-ml-2 max-md:inline-flex max-md:h-11 max-md:items-center max-md:px-2 max-md:text-sm max-md:active:text-foreground";

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
  const { user, isAdmin, workspaceId } = useAuth();
  const workspacePeople = useQuery(workspacePeopleQuery(workspaceId));
  const peopleById = useMemo(
    () => new Map((workspacePeople.data ?? []).map((person) => [person.id, person])),
    [workspacePeople.data],
  );
  const queryClient = useQueryClient();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isMobile = useIsMobile();

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
        <div className="mx-auto max-w-[1120px] px-4 pb-16 pt-6 md:px-8 max-md:pb-4 max-md:pt-1">
          <TicketBackButton isAdmin={isAdmin} projectId={t.project_id} />

          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 max-md:mt-1 max-md:gap-2">
            <span className="font-mono text-muted-foreground">#{t.ticket_number}</span>
            <StatusPill tone={TICKET_STATUS_TONE[t.status]}>
              {TICKET_STATUS_LABEL[t.status]}
            </StatusPill>
            {t.status === "open" && t.follow_up_kind && (
              <StatusPill tone="warning">Follow-up: {t.follow_up_kind}</StatusPill>
            )}
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
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs text-destructive hover:text-destructive max-md:-mr-2"
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Delete
              </Button>
            )}
          </div>
          <TicketDeleteDialog
            tickets={[{ id: t.id, title: t.title, number: t.ticket_number }]}
            open={deleting}
            onOpenChange={setDeleting}
            onDeleted={() =>
              router.history.canGoBack()
                ? router.history.back()
                : router.navigate({ to: "/app/triage" })
            }
          />
          <h1 className="mt-2.5 max-w-[820px] font-display text-[38px] font-normal leading-[1.15] max-md:mt-2 max-md:break-words max-md:text-[28px] max-md:leading-tight">
            {t.title}
          </h1>
          {user?.id === t.reporter_id && (
            <TicketEditButton ticketId={t.id} title={t.title} description={t.description} />
          )}

          {isMobile && (
            <div className="mt-4 space-y-3">
              {isAdmin && <TicketQuickStatus ticket={t} />}
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                aria-haspopup="dialog"
                className="flex h-12 w-full items-center gap-2.5 rounded-xl border bg-surface px-4 text-left text-sm transition-colors active:bg-muted"
              >
                <SlidersHorizontal
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="font-medium">Details</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {isAdmin
                    ? "Assignee, dates, labels, time"
                    : t.eta_date
                      ? `Aiming for ${formatDate(t.eta_date)}`
                      : "ETA not set yet"}
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            </div>
          )}

          <div className="mt-7 grid items-start gap-8 max-md:mt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-8 max-md:space-y-6">
              <section aria-labelledby="sent">
                <h2 id="sent" className="mb-2.5 font-display text-2xl font-normal max-md:text-xl">
                  What they sent
                </h2>
                <div className="rounded-xl border bg-card px-5 py-[18px] leading-relaxed max-md:px-4 max-md:py-4">
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

              <section className="space-y-3.5 max-md:pb-20" aria-labelledby="conversation">
                <h2
                  id="conversation"
                  className="font-display text-[26px] font-normal max-md:text-xl"
                >
                  Conversation
                </h2>
                <SectionBoundary label="timeline">
                  <TicketTimeline
                    comments={comments.data ?? []}
                    events={events.data ?? []}
                    showInternal={isAdmin}
                    reporterId={t.reporter_id}
                    people={peopleById}
                  />
                </SectionBoundary>
                {user && (
                  <CommentBox
                    ticketId={ticketId}
                    projectId={t.project_id}
                    userId={user.id}
                    isAdmin={isAdmin}
                  />
                )}
              </section>
            </div>

            {isMobile ? (
              <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
                <SheetContent
                  side="bottom"
                  className="gap-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-11"
                >
                  <SheetTitle className="mb-3 font-display text-xl font-normal">Details</SheetTitle>
                  <SheetDescription className="sr-only">
                    Properties, dates, labels and links for this ticket.
                  </SheetDescription>
                  <SectionBoundary label="ticket-sidebar">
                    {isAdmin && user ? (
                      <TicketSidebar ticket={t} userId={user.id} />
                    ) : (
                      <ClientProperties ticket={t} />
                    )}
                  </SectionBoundary>
                </SheetContent>
              </Sheet>
            ) : (
              <aside>
                <SectionBoundary label="ticket-sidebar">
                  {isAdmin && user ? (
                    <TicketSidebar ticket={t} userId={user.id} />
                  ) : (
                    <ClientProperties ticket={t} />
                  )}
                </SectionBoundary>
              </aside>
            )}
          </div>
        </div>
      )}
    </QueryState>
  );
}

function TicketEditButton({
  ticketId,
  title: originalTitle,
  description: originalDescription,
}: {
  ticketId: string;
  title: string;
  description: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(originalTitle);
  const [description, setDescription] = useState(originalDescription ?? "");
  const save = useServerAction(useServerFn(editOwnTicket), {
    label: "tickets.editOwn",
    invalidate: [qk.ticket(ticketId), qk.ticketEvents(ticketId), qk.tickets()],
    onSuccess: () => {
      setOpen(false);
      toast.success("Ticket updated");
    },
  });
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 max-md:w-full"
        onClick={() => setOpen(true)}
      >
        Edit my ticket
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit your ticket</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.fire({ ticketId, title, description });
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="ticket-edit-title">Title</Label>
              <Input
                id="ticket-edit-title"
                value={title}
                maxLength={200}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ticket-edit-description">Description</Label>
              <RichTextEditor
                id="ticket-edit-description"
                value={description}
                onChange={setDescription}
              />
            </div>
            <div className="flex justify-end gap-2 max-md:flex-col-reverse max-md:[&>button]:w-full">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.busy || !title.trim()}>
                {save.busy ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
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
  projectId,
  userId,
  isAdmin,
}: {
  ticketId: string;
  projectId: string | null;
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
  const [followUpKind, setFollowUpKind] = useState<"improvement" | "fix" | "">("");
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const isMobile = useIsMobile();
  // On a phone the composer lives pinned above the tab bar, and starts as a
  // single line so the conversation keeps the screen until someone replies.
  const [expanded, setExpanded] = useState(false);

  const people = useQuery(workspacePeopleQuery(workspaceId));

  useEffect(() => {
    try {
      if (body.trim()) sessionStorage.setItem(replyDraftKey(ticketId), body);
      else sessionStorage.removeItem(replyDraftKey(ticketId));
    } catch {
      /* ignore */
    }
  }, [body, ticketId]);

  // An internal note is for the agency: only admins are offered, since only
  // they can read it (and only they are notified about it).
  // A client is offered the agency and the people on this project, not every
  // client of the agency.
  const projectMembers = useQuery({
    ...projectMembersQuery(projectId ?? ""),
    enabled: Boolean(projectId) && !isAdmin,
  });
  const mentionPeople = useMemo(() => {
    const onProject = new Set((projectMembers.data ?? []).map((member) => member.user_id));
    return (people.data ?? []).filter((person) =>
      internal
        ? person.role === "admin"
        : isAdmin || person.role === "admin" || onProject.has(person.id),
    );
  }, [people.data, internal, isAdmin, projectMembers.data]);

  const notify = useServerFn(notifyTicketComment);

  const post = useServerAction(useServerFn(addComment), {
    label: "tickets.addComment",
    invalidate: [
      qk.ticket(ticketId),
      qk.ticketComments(ticketId),
      qk.ticketEvents(ticketId),
      qk.tickets(),
    ],
  });

  const draft = useServerAction(useServerFn(draftReply), {
    label: "ai.draftReply",
    errorMessage: "Couldn't draft a reply.",
    onSuccess: (result) =>
      setBody((current) => (current ? `${current}<p></p>` : "") + `<p>${result.reply}</p>`),
  });

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = plainText(body);
    if (!text && drafts.length === 0) return;

    let commentId: string | undefined;
    if (text) {
      const result = await post.run({
        ticketId,
        body: body.trim(),
        isInternal: internal,
        followUpKind: followUpKind || undefined,
      });
      commentId = typeof result?.id === "string" ? result.id : undefined;
    }

    if (drafts.length > 0) {
      setUploading(true);
      const outcome = await uploadDrafts(ticketId, userId, drafts);
      setUploading(false);
      const problem = describeOutcome(outcome);
      if (problem) toast.error(problem);
    }

    // The server reads the comment back for its mentions and excerpt; an
    // internal note only reaches the agency people mentioned in it.
    if (commentId) {
      void notify({ data: { ticketId, commentId } }).catch(() => {});
    }

    setBody("");
    setDrafts([]);
    setInternal(false);
    setFollowUpKind("");
    setExpanded(false);
    try {
      sessionStorage.removeItem(replyDraftKey(ticketId));
    } catch {
      /* ignore */
    }
  };

  const expand = () => {
    // Focus inside the tap, or iOS will not raise the keyboard.
    flushSync(() => setExpanded(true));
    document.getElementById("reply")?.focus();
  };

  const busy = post.busy || uploading;
  const placeholder = useMemo(
    () =>
      isAdmin
        ? "Reply to the client… Type @ to mention a teammate"
        : "Add anything else that might help… Type @ to mention someone",
    [isAdmin],
  );

  const collapsed = isMobile && !expanded;

  return (
    <form
      onSubmit={send}
      className={`space-y-3 rounded-xl border p-3 transition-colors max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(var(--mobile-tabbar-h)+var(--mobile-timer-h))] max-md:z-30 max-md:mt-0 max-md:max-h-[min(72dvh,34rem)] max-md:space-y-2.5 max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-none max-md:border-x-0 max-md:border-b-0 max-md:px-4 max-md:shadow-[0_-10px_24px_-14px_rgba(0,0,0,0.3)] ${
        internal ? "border-warning/40 bg-warning/10" : "bg-card"
      }`}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={expand}
          className="flex h-12 w-full items-center rounded-full border bg-background px-4 text-left text-base text-muted-foreground active:bg-muted"
        >
          <span className="min-w-0 truncate">
            {plainText(body) ? "Continue your reply…" : placeholder}
          </span>
        </button>
      ) : (
        <>
          {isMobile && (
            <div className="-mt-1 flex items-center justify-between">
              <span className="text-sm font-medium">
                {internal ? "Internal note" : isAdmin ? "Reply to the client" : "Reply"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-mr-2"
                aria-label="Collapse reply box"
                onClick={() => setExpanded(false)}
              >
                <ChevronDown className="h-5 w-5" aria-hidden="true" />
              </Button>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="reply" className="sr-only">
              Your reply
            </Label>
            <RichTextEditor
              id="reply"
              value={body}
              onChange={setBody}
              placeholder={placeholder}
              mentionPeople={mentionPeople}
              mentionExcludeId={userId}
            />
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
            compact
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
                onClick={() => {
                  setInternal((value) => !value);
                  setFollowUpKind("");
                }}
              >
                Internal note
              </Button>
            )}
            {!internal && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground max-md:w-full max-md:text-sm">
                <span>Follow-up</span>
                <select
                  className="rounded-md border bg-background px-2 py-1.5 max-md:h-11 max-md:flex-1"
                  value={followUpKind}
                  onChange={(event) => setFollowUpKind(event.target.value as typeof followUpKind)}
                >
                  <option value="">None</option>
                  <option value="improvement">Open for improvement</option>
                  <option value="fix">Open for fix</option>
                </select>
              </label>
            )}
            <span className="flex-1 max-md:hidden" />
            <Button
              type="submit"
              className="max-md:h-12 max-md:w-full max-md:text-base"
              disabled={
                busy || (followUpKind ? !plainText(body) : !plainText(body) && drafts.length === 0)
              }
            >
              {busy ? "Sending…" : internal ? "Add note" : "Send reply"}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
