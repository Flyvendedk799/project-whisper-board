import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ArrowLeft, Camera, Check, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader, StatusPill } from "@/components/app-shell";
import { SectionBoundary } from "@/components/error-boundary";
import { useAuth } from "@/components/auth-provider";
import { CaptureDropzone } from "@/features/capture/capture-dropzone";
import { RecorderPanel } from "@/features/capture/recorder-panel";
import { ScreenshotAnnotator } from "@/features/capture/screenshot-annotator";
import {
  AiComposePanel,
  composeDescription,
  type TicketDraft,
} from "@/features/capture/ai-compose-panel";
import { captureScreenshot, loadImage } from "@/features/capture/screenshot";
import { flattenToBlob } from "@/features/capture/annotation-canvas";
import {
  collectCaptureContext,
  summariseContext,
  type CaptureContextInput,
} from "@/features/capture/capture-context";
import { emptyDoc, redactsContent, type AnnotationDoc } from "@/features/capture/annotation-model";
import { useServerAction } from "@/lib/use-server-action";
import { createTicket } from "@/lib/tickets.functions";
import { composeTicketFromCapture } from "@/lib/ai/compose.functions";
import { useAiEnabled } from "@/hooks/use-ai-enabled";
import { useIsMobile } from "@/hooks/use-mobile";
import { describeOutcome, newDraftId, uploadDrafts, type DraftAttachment } from "@/lib/upload";
import { projectListQuery } from "@/data/projects";
import { qk } from "@/data/keys";
import {
  TICKET_TYPES,
  TICKET_TYPE_LABEL,
  type TicketPriority,
  type TicketType,
} from "@/data/enums";
import { AppError } from "@/lib/errors";
import { toast } from "sonner";

/**
 * Reporting something, for a person who is not a developer.
 *
 * The screenshot and the recording come first, because showing the problem is
 * the easy part for a non-technical client and describing it is the hard part.
 * Kind, project, title and details follow, and "Write it up with AI" drafts the
 * words from what they showed — offered, never applied without being asked.
 *
 * `?url=` carries the page they were on when they pressed Report.
 */
export const Route = createFileRoute("/app/report")({
  validateSearch: z.object({
    project: z.string().uuid().optional(),
    url: z.string().optional(),
  }),
  component: ReportPage,
});

const REPORT_DRAFT_KEY = "cf.report.form";

type ReportDraft = {
  projectId?: string;
  title: string;
  description: string;
  type: TicketType;
  priority: TicketPriority;
};

function readReportDraft(): Partial<ReportDraft> {
  try {
    const raw = sessionStorage.getItem(REPORT_DRAFT_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<ReportDraft>;
  } catch {
    return {};
  }
}

function ReportPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [leaving, setLeaving] = useState(false);
  const { user, isAdmin, workspaceId } = useAuth();
  const aiEnabled = useAiEnabled();
  const saved = useMemo(() => readReportDraft(), []);

  const [projectId, setProjectId] = useState<string | undefined>(search.project ?? saved.projectId);
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [annotating, setAnnotating] = useState<{
    draft: DraftAttachment;
    image: HTMLImageElement;
  } | null>(null);
  const [title, setTitle] = useState(saved.title ?? "");
  const [description, setDescription] = useState(saved.description ?? "");
  const [type, setType] = useState<TicketType>(saved.type ?? "bug");
  const [priority, setPriority] = useState<TicketPriority>(saved.priority ?? "medium");
  const [aiDraft, setAiDraft] = useState<TicketDraft | null>(null);

  // Captured when the page opens, not on submit: navigating here already
  // changed location.href, and the page they were on is the useful bit.
  const contextRef = useRef<CaptureContextInput>(
    collectCaptureContext(search.url ? { url: search.url } : {}),
  );

  const projects = useQuery(projectListQuery(workspaceId));
  const chosenProject = projects.data?.find((p) => p.id === projectId) ?? projects.data?.[0];

  // Prefer `?project=` over a stale draft when the URL carries one.
  useEffect(() => {
    if (search.project) setProjectId(search.project);
  }, [search.project]);

  useEffect(() => {
    if (projectId) return;
    if (projects.data?.length === 1) setProjectId(projects.data[0].id);
  }, [projectId, projects.data]);

  useEffect(() => {
    try {
      const payload: ReportDraft = { projectId, title, description, type, priority };
      sessionStorage.setItem(REPORT_DRAFT_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [projectId, title, description, type, priority]);

  // Object URLs outlive the component unless they are revoked.
  useEffect(
    () => () => drafts.forEach((d) => d.previewUrl && URL.revokeObjectURL(d.previewUrl)),
    [drafts],
  );

  const addFiles = useCallback((files: File[], kind: DraftAttachment["kind"] = "file") => {
    setDrafts((prev) => [
      ...prev,
      ...files.map<DraftAttachment>((file) => ({
        id: newDraftId(),
        file,
        bucket: file.type.startsWith("video/") ? "recordings" : "attachments",
        kind: file.type.startsWith("video/")
          ? "recording"
          : file.type.startsWith("image/")
            ? kind
            : "file",
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      })),
    ]);
  }, []);

  const compose = useServerAction(useServerFn(composeTicketFromCapture), {
    label: "ai.composeTicket",
    errorMessage: "Couldn't draft that. Write what you can and send it.",
    onSuccess: (draft) => setAiDraft(draft),
  });

  const create = useServerAction(useServerFn(createTicket), {
    label: "tickets.create",
    invalidate: [qk.tickets(), qk.projects()],
  });

  const takeScreenshot = async () => {
    try {
      const file = await captureScreenshot();
      addFiles([file], "screenshot");
      // Straight into the annotator: the reason for a screenshot is almost
      // always to point at something in it.
      const image = await loadImage(file);
      setDrafts((prev) => {
        const draft = prev.at(-1);
        if (draft) setAnnotating({ draft, image });
        return prev;
      });
    } catch (error) {
      toast.error(error instanceof AppError ? error.message : "Couldn't capture the screen.");
    }
  };

  const openAnnotator = async (draft: DraftAttachment) => {
    try {
      setAnnotating({ draft, image: await loadImage(draft.file) });
    } catch {
      toast.error("Couldn't open that image.");
    }
  };

  const saveAnnotation = async (doc: AnnotationDoc) => {
    if (!annotating) return;
    const { draft, image } = annotating;

    try {
      const blob = await flattenToBlob(image, doc);
      const annotated = new File([blob], draft.file.name.replace(/(\.\w+)?$/, "-marked.webp"), {
        type: blob.type,
      });

      setDrafts((prev) => {
        const withoutOriginal = redactsContent(doc);
        // A blur means the untouched original must not be uploaded — shipping
        // both would defeat the tool entirely.
        const next = prev.filter((d) => d.id !== draft.id || !withoutOriginal);
        return [
          ...next.map((d) => (d.id === draft.id ? { ...d, kind: "screenshot" as const } : d)),
          {
            id: newDraftId(),
            file: annotated,
            bucket: "attachments" as const,
            kind: "annotated" as const,
            previewUrl: URL.createObjectURL(annotated),
            annotations: doc,
            width: doc.sourceWidth,
            height: doc.sourceHeight,
            sourceDraftId: withoutOriginal ? undefined : draft.id,
          },
        ];
      });
      setAnnotating(null);
    } catch {
      toast.error("Couldn't save those marks.");
    }
  };

  const askAi = async () => {
    if (!chosenProject) return;
    // Send the marked-up images inline so nothing has to be uploaded before the
    // person has decided to file anything.
    const images = await Promise.all(
      drafts
        .filter((d) => d.file.type.startsWith("image/"))
        .slice(0, 3)
        .map(toDataUrl),
    );
    const note = [title.trim(), description.trim()].filter(Boolean).join("\n");
    await compose.run({
      projectId: chosenProject.id,
      note: note || undefined,
      inlineImages: images.filter((url): url is string => Boolean(url)),
      context: contextRef.current as Record<string, unknown>,
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosenProject || !user) return;

    const { id } = await create.run({
      projectId: chosenProject.id,
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      priority,
      context: contextRef.current,
    });

    if (drafts.length > 0) {
      const outcome = await uploadDrafts(id, user.id, drafts);
      const problem = describeOutcome(outcome);
      if (problem) toast.error(problem);
    }

    toast.success("Sent. We'll pick it up from here.");
    try {
      sessionStorage.removeItem(REPORT_DRAFT_KEY);
    } catch {
      /* ignore */
    }
    void navigate({ to: "/app/tickets/$ticketId", params: { ticketId: id } });
  };

  const contextSummary = useMemo(() => summariseContext(contextRef.current), []);

  const goBack = () => {
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: "/app" });
  };
  // The words are kept in the draft; pictures and recordings are not, so only
  // those are worth a second thought before leaving.
  const requestLeave = () => (drafts.length > 0 ? setLeaving(true) : goBack());

  if (projects.isSuccess && (projects.data?.length ?? 0) === 0) {
    return (
      <>
        <MobileBackBar onBack={goBack} />
        <PageHeader title="Report an issue" />
        <div className="mx-auto max-w-2xl px-4 py-16">
          <EmptyState
            title="No projects yet"
            description={
              isAdmin
                ? "Create a project first. Tickets hang off projects, so there's nowhere to file this yet."
                : "Once you've been added to a project you can report things against it."
            }
            action={
              isAdmin ? (
                <Button asChild>
                  <Link to="/app/projects">Create a project</Link>
                </Button>
              ) : (
                <Button variant="outline" asChild>
                  <Link to="/app/inbox">Check your inbox</Link>
                </Button>
              )
            }
          />
        </div>
      </>
    );
  }

  if (annotating) {
    const annotatorProps = {
      image: annotating.image,
      initialDoc:
        (annotating.draft.annotations as AnnotationDoc | undefined) ??
        emptyDoc(annotating.image.naturalWidth, annotating.image.naturalHeight),
      onCancel: () => setAnnotating(null),
      onSave: saveAnnotation,
    };

    // On a phone the editor takes the whole screen: the picture fits between a
    // header and a bottom toolbar, so drawing never fights the page for the touch.
    if (isMobile) {
      return (
        <SectionBoundary label="annotator">
          <AnnotatorStep {...annotatorProps} mobile />
        </SectionBoundary>
      );
    }

    return (
      <>
        <PageHeader
          title="Point at the problem"
          description="Circle it, draw an arrow, or blur out anything private."
          action={
            <Button variant="ghost" onClick={() => setAnnotating(null)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Back
            </Button>
          }
        />
        <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
          <SectionBoundary label="annotator">
            <AnnotatorStep {...annotatorProps} />
          </SectionBoundary>
        </div>
      </>
    );
  }

  const images = drafts.filter((d) => d.file.type.startsWith("image/"));

  return (
    <form
      onSubmit={submit}
      className="mx-auto flex max-w-[720px] flex-col gap-[22px] px-4 pb-16 pt-9 md:px-8 max-md:gap-5 max-md:pb-0 max-md:pt-1"
    >
      <MobileBackBar onBack={requestLeave} close />

      <div>
        <h1 className="font-display text-[38px] font-normal leading-tight max-md:text-[30px]">
          Point at the problem
        </h1>
        <p className="mt-1.5 leading-normal text-muted-foreground max-md:text-[15px]">
          A screenshot or a short recording is usually enough. Add a sentence on what you expected.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <CaptureDropzone
          drafts={drafts}
          onAdd={(files) => addFiles(files)}
          onRemove={(id) => setDrafts((prev) => prev.filter((d) => d.id !== id))}
          label="Screenshot"
          title="Screenshot"
          description="Paste, drop, or choose an image. You can mark it up."
          touchPicker
          onCaptureScreen={() => void takeScreenshot()}
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => void takeScreenshot()}>
              <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Capture this screen
            </Button>
          }
        />
        <SectionBoundary label="recorder">
          <RecorderPanel
            onRecorded={({ file, durationMs, hasAudio }) =>
              setDrafts((prev) => [
                ...prev,
                {
                  id: newDraftId(),
                  file,
                  bucket: "recordings",
                  kind: "recording",
                  durationMs,
                  hasAudio,
                },
              ])
            }
          />
        </SectionBoundary>
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 max-md:grid max-md:grid-cols-2 max-md:gap-3">
          {images.map((draft) => (
            <div
              key={draft.id}
              className="relative h-20 w-28 max-md:aspect-[4/3] max-md:h-auto max-md:w-full"
            >
              <button
                type="button"
                onClick={() => void openAnnotator(draft)}
                className="group relative h-full w-full overflow-hidden rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <img
                  src={draft.previewUrl}
                  alt={`Mark up ${draft.file.name}`}
                  className="h-full w-full object-cover"
                />
                <span className="absolute inset-0 grid place-items-center bg-foreground/60 text-xs font-medium text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:h-9 max-md:bg-foreground/70 max-md:text-[13px] max-md:opacity-100">
                  <span className="max-md:hidden">Mark it up</span>
                  <span className="md:hidden">Tap to mark it up</span>
                </span>
                {draft.kind === "annotated" && (
                  <span className="absolute right-1 top-1 max-md:left-1.5 max-md:right-auto max-md:top-1.5">
                    <StatusPill tone="success">Marked</StatusPill>
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-label={`Remove ${draft.file.name}`}
                onClick={() => setDrafts((prev) => prev.filter((d) => d.id !== draft.id))}
                className="absolute -right-1.5 -top-1.5 hidden h-11 w-11 place-items-center max-md:grid"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full border bg-background shadow">
                  <X className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div id="kind-label" className="text-xs font-medium text-muted-foreground">
          What kind of thing is it?
        </div>
        <div
          role="group"
          aria-labelledby="kind-label"
          className="flex flex-wrap gap-1.5 max-md:gap-2"
        >
          {TICKET_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => setType(value)}
              className={`h-[34px] rounded-full border px-3.5 text-[13px] transition-colors max-md:h-11 max-md:px-4 max-md:text-sm ${
                type === value ? "border-primary bg-accent font-medium" : "bg-card hover:bg-muted"
              }`}
            >
              {TICKET_TYPE_LABEL[value]}
            </button>
          ))}
        </div>
      </div>

      {(projects.data?.length ?? 0) > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project" className="text-xs text-muted-foreground">
            Project
          </Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="project" className="h-[42px]">
              <SelectValue placeholder="Pick a project" />
            </SelectTrigger>
            <SelectContent>
              {(projects.data ?? []).map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title" className="text-xs text-muted-foreground">
          Short title
        </Label>
        <Input
          id="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Pay now button does nothing on iPhone"
          autoComplete="off"
          enterKeyHint="next"
          className="h-11 text-[15px]"
        />
      </div>

      {compose.busy && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border bg-accent/30 p-4 text-sm"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          Reading what you sent and writing a draft…
        </div>
      )}

      {aiDraft && !compose.busy && (
        <AiComposePanel
          draft={aiDraft}
          busy={compose.busy}
          onRegenerate={() => void askAi()}
          onUseTitle={() => setTitle(aiDraft.title)}
          onUseDescription={() => setDescription(composeDescription(aiDraft))}
          onUseAll={() => {
            setTitle(aiDraft.title);
            setDescription(composeDescription(aiDraft));
            setType(aiDraft.type);
            setPriority(aiDraft.priority);
            toast.success("Filled in. Edit anything that isn't right.");
          }}
        />
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center">
          <Label htmlFor="description" className="flex-1 text-xs text-muted-foreground">
            Details
          </Label>
          {aiEnabled && (
            <button
              type="button"
              disabled={compose.busy || !chosenProject}
              onClick={() => void askAi()}
              className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50 max-md:-my-2 max-md:-mr-2 max-md:min-h-11 max-md:gap-1.5 max-md:px-2 max-md:text-[13px]"
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Write it up with AI
            </button>
          )}
        </div>
        <Textarea
          id="description"
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened, and what did you expect?"
          className="px-3.5 py-3 leading-relaxed max-md:min-h-36"
        />
        <p className="text-xs text-muted-foreground max-md:break-words">
          We&rsquo;ll also send your browser details automatically
          {contextSummary ? `: ${contextSummary}` : ""}.
        </p>
      </div>

      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor="priority" className="text-xs text-muted-foreground">
          How urgent?
        </Label>
        <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
          <SelectTrigger id="priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Whenever you get to it</SelectItem>
            <SelectItem value="medium">Soon would be good</SelectItem>
            <SelectItem value="high">It&rsquo;s holding me up</SelectItem>
            <SelectItem value="urgent">It&rsquo;s costing me money</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end max-md:sticky max-md:bottom-0 max-md:z-30 max-md:-mx-4 max-md:flex-col max-md:border-t max-md:bg-background/95 max-md:px-4 max-md:pb-[calc(0.75rem+var(--safe-bottom)+var(--mobile-timer-h,0px))] max-md:pt-3 max-md:backdrop-blur">
        {!title.trim() && (
          <p className="mb-2 text-center text-xs text-muted-foreground md:hidden">
            Add a short title to send this.
          </p>
        )}
        <Button
          type="submit"
          className="h-11 px-6 max-md:h-12 max-md:w-full max-md:text-base"
          disabled={create.busy || !title.trim() || !chosenProject}
        >
          {create.busy ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              Sending
            </>
          ) : (
            "Send"
          )}
        </Button>
      </div>

      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without sending?</AlertDialogTitle>
            <AlertDialogDescription>
              What you typed is kept, but the photos and recordings you added aren&rsquo;t.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction onClick={goBack}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

/** The way out of the report flow on a phone, where the tab bar is not there to leave by. */
function MobileBackBar({ onBack, close = false }: { onBack: () => void; close?: boolean }) {
  return (
    <div className="-mx-1 flex md:hidden">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground active:bg-muted active:text-foreground"
      >
        {close ? (
          <X className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        )}
        {close ? "Close" : "Back"}
      </button>
    </div>
  );
}

function AnnotatorStep({
  image,
  initialDoc,
  onCancel,
  onSave,
  mobile = false,
}: {
  image: HTMLImageElement;
  initialDoc: AnnotationDoc;
  onCancel: () => void;
  onSave: (doc: AnnotationDoc) => void;
  mobile?: boolean;
}) {
  const [doc, setDoc] = useState(initialDoc);

  if (mobile) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col overscroll-none bg-background pt-[var(--safe-top)]">
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Cancel
          </Button>
          <h1 className="font-display text-lg">Mark it up</h1>
          <Button type="button" onClick={() => onSave(doc)}>
            <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Done
          </Button>
        </div>
        <p className="shrink-0 px-4 py-2 text-xs text-muted-foreground">
          Drag on the picture to draw. Blur out hides anything private, and the original is never
          sent once you do.
        </p>
        <div className="min-h-0 flex-1">
          <ScreenshotAnnotator image={image} initialDoc={initialDoc} onChange={setDoc} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScreenshotAnnotator image={image} initialDoc={initialDoc} onChange={setDoc} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => onSave(doc)}>
          <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Done
        </Button>
      </div>
    </div>
  );
}

async function toDataUrl(draft: DraftAttachment): Promise<string | null> {
  // 6MB of base64 is already a lot to put in a request body; skip anything
  // bigger rather than timing out the Worker.
  if (draft.file.size > 4 * 1024 * 1024) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(draft.file);
  });
}
