import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Video, X, FileText, Image as ImageIcon, Square } from "lucide-react";
import { toast } from "sonner";

export type DraftAttachment = {
  file: File;
  bucket: "attachments" | "recordings";
  previewUrl?: string;
};

export function TicketAttachmentsField({
  drafts,
  setDrafts,
}: {
  drafts: DraftAttachment[];
  setDrafts: React.Dispatch<React.SetStateAction<DraftAttachment[]>>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  function addFiles(files: FileList | File[], bucket: "attachments" | "recordings" = "attachments") {
    const newDrafts = Array.from(files).map<DraftAttachment>((file) => ({
      file,
      bucket,
      previewUrl: file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : undefined,
    }));
    setDrafts((prev) => [...prev, ...newDrafts]);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const file = new File([blob], `recording-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm`, { type: "video/webm" });
        addFiles([file], "recordings");
        stream.getTracks().forEach((t) => t.stop());
      };
      stream.getVideoTracks()[0].addEventListener("ended", () => recorder.state !== "inactive" && recorder.stop());
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not start recording");
    }
  }
  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }

  return (
    <div
      onPaste={onPaste}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      tabIndex={0}
      className="border border-dashed rounded-md p-4 space-y-3 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="h-4 w-4 mr-1.5" />Add files
        </Button>
        {recording ? (
          <Button type="button" variant="destructive" size="sm" onClick={stopRecording}>
            <Square className="h-4 w-4 mr-1.5" />Stop recording
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={startRecording}>
            <Video className="h-4 w-4 mr-1.5" />Record screen
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">Drag, drop, or paste from clipboard</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && addFiles(e.target.files)}
      />
      {drafts.length > 0 && (
        <ul className="space-y-1.5">
          {drafts.map((d, i) => (
            <li key={i} className="flex items-center gap-2 text-sm bg-muted/50 rounded px-2 py-1.5">
              {d.previewUrl ? (
                d.file.type.startsWith("image/") ? <ImageIcon className="h-4 w-4 text-muted-foreground" /> : <Video className="h-4 w-4 text-muted-foreground" />
              ) : <FileText className="h-4 w-4 text-muted-foreground" />}
              <span className="flex-1 truncate">{d.file.name}</span>
              <span className="text-xs text-muted-foreground">{(d.file.size / 1024).toFixed(0)} KB</span>
              <button type="button" onClick={() => setDrafts((p) => p.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
