import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ArrowLeft, Camera, Check, Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { describeOutcome, newDraftId, uploadDrafts, type DraftAttachment } from "@/lib/upload";
import { projectListQuery } from "@/data/projects";
import { qk } from "@/data/keys";
import {
  TICKET_TYPES,
  TICKET_TYPE_PROMPT,
  type TicketPriority,
  type TicketType,
} from "@/data/enums";
import { AppError } from "@/lib/errors";
import { toast } from "sonner";
import { FolderKanban } from "lucide-react";

/**
 * Reporting something, for a person who is not a developer.
 *
 * The form this replaces asked for a title, a description, a type and a
 * priority — the four things a non-technical client is least equipped to
 * supply, and the reason so many reports arrive as "it's broken". Here they
 * show the problem, say one line about it, and the draft is written for them.
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

type Step = "capture" | "describe";

function ReportPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [step, setStep] = useState<Step>("capture");
  const [projectId, setProjectId] = useState<string | undefined>(search.project);
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [annotating, setAnnotating] = useState<{
    draft: DraftAttachment;
    image: HTMLImageElement;
  } | null>(null);
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TicketType>("bug");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [aiDraft, setAiDraft] = useState<TicketDraft | null>(null);

  // Captured when the page opens, not on submit: navigating here already
  // changed location.href, and the page they were on is the useful bit.
  const contextRef = useRef<CaptureContextInput>(
    collectCaptureContext(search.url ? { url: search.url } : {}),
  );

  const projects = useQuery(projectListQuery());
  const chosenProject = projects.data?.find((p) => p.id === projectId) ?? projects.data?.[0];

  useEffect(() => {
    if (!projectId && projects.data?.length === 1) setProjectId(projects.data[0].id);
  }, [projectId, projects.data]);

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
    await compose.run({
      projectId: chosenProject.id,
      note: note.trim() || undefined,
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
    void navigate({ to: "/app/tickets/$ticketId", params: { ticketId: id } });
  };

  const contextSummary = useMemo(() => summariseContext(contextRef.current), []);

  if (projects.isSuccess && (projects.data?.length ?? 0) === 0) {
    return (
      <>
        <PageHeader title="Report an issue" />
        <div className="mx-auto max-w-2xl px-4 py-16">
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Once you've been added to a project you can report things against it."
          />
        </div>
      </>
    );
  }

  if (annotating) {
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
            <AnnotatorStep
              image={annotating.image}
              initialDoc={
                (annotating.draft.annotations as AnnotationDoc | undefined) ??
                emptyDoc(annotating.image.naturalWidth, annotating.image.naturalHeight)
              }
              onCancel={() => setAnnotating(null)}
              onSave={saveAnnotation}
            />
          </SectionBoundary>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Report an issue"
        description={step === "capture" ? "Show us what happened." : "Nearly there."}
      />

      <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 md:px-8 md:py-8">
        <ol className="flex items-center gap-2 text-sm" aria-label="Progress">
          <StepPill n={1} label="Show us" active={step === "capture"} done={step === "describe"} />
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
          <StepPill n={2} label="Describe" active={step === "describe"} done={false} />
        </ol>

        {step === "capture" ? (
          <div className="space-y-5">
            {(projects.data?.length ?? 0) > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="project">Which project?</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger id="project">
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

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void takeScreenshot()}>
                <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Take a screenshot
              </Button>
            </div>

            <CaptureDropzone
              drafts={drafts}
              onAdd={(files) => addFiles(files)}
              onRemove={(id) => setDrafts((prev) => prev.filter((d) => d.id !== id))}
              label="Or attach something"
            />

            {drafts.some((d) => d.file.type.startsWith("image/")) && (
              <div className="flex flex-wrap gap-2">
                {drafts
                  .filter((d) => d.file.type.startsWith("image/"))
                  .map((draft) => (
                    <button
                      key={draft.id}
                      type="button"
                      onClick={() => void openAnnotator(draft)}
                      className="group relative h-20 w-28 overflow-hidden rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <img
                        src={draft.previewUrl}
                        alt={`Mark up ${draft.file.name}`}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute inset-0 grid place-items-center bg-foreground/60 text-xs font-medium text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        Mark it up
                      </span>
                      {draft.kind === "annotated" && (
                        <span className="absolute right-1 top-1">
                          <StatusPill tone="success">Marked</StatusPill>
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="note">What went wrong?</Label>
              <Textarea
                id="note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="One line is plenty — the checkout button doesn't do anything on my phone."
              />
            </div>

            <p className="text-xs text-muted-foreground">
              We&rsquo;ll also send your browser details automatically
              {contextSummary ? `: ${contextSummary}` : ""}.
            </p>

            <Button
              type="button"
              className="w-full"
              disabled={!chosenProject || (!note.trim() && drafts.length === 0)}
              onClick={() => {
                setStep("describe");
                void askAi();
              }}
            >
              Next
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            {compose.busy && (
              <div className="flex items-center gap-2 rounded-lg border bg-accent/30 p-4 text-sm">
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
                  toast.success("Filled in — edit anything that isn't right.");
                }}
              />
            )}

            {!aiDraft && !compose.busy && (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <Sparkles className="mb-1.5 h-4 w-4" aria-hidden="true" />
                Write a title and whatever detail you have. Anything you missed, we&rsquo;ll ask.
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Checkout button does nothing on mobile"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Details</Label>
              <Textarea
                id="description"
                rows={8}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="type">What is this?</Label>
                <Select value={type} onValueChange={(v) => setType(v as TicketType)}>
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TICKET_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {TICKET_TYPE_PROMPT[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="priority">How urgent?</Label>
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
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setStep("capture")}>
                <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Back
              </Button>
              <Button type="submit" className="flex-1" disabled={create.busy || !title.trim()}>
                {create.busy ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                    Sending
                  </>
                ) : (
                  <>
                    <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Send it
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

function AnnotatorStep({
  image,
  initialDoc,
  onCancel,
  onSave,
}: {
  image: HTMLImageElement;
  initialDoc: AnnotationDoc;
  onCancel: () => void;
  onSave: (doc: AnnotationDoc) => void;
}) {
  const [doc, setDoc] = useState(initialDoc);
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

function StepPill({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-current={active ? "step" : undefined}
        className={`grid h-6 w-6 place-items-center rounded-full text-xs font-medium ${
          done
            ? "bg-success/20 text-success"
            : active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : n}
      </span>
      <span className={active ? "font-medium" : "text-muted-foreground"}>{label}</span>
    </li>
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
