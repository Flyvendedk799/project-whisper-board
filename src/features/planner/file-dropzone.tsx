import { useId, useState } from "react";
import { PLAN_ATTACHMENT_ACCEPT_HINT } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { hasFiles } from "./plan-model";

/** The dashed "choose files or drop them here" box, for a task and for the plan itself. */
export function FileDropzone({
  onFiles,
  prompt = "or drop them here",
  ariaLabel = "Attach files",
}: {
  onFiles: (files: File[]) => void;
  /** What follows the bold "Choose files". */
  prompt?: string;
  ariaLabel?: string;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);

  return (
    <label
      htmlFor={inputId}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const dropped = Array.from(event.dataTransfer.files);
        if (dropped.length) onFiles(dropped);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-1 rounded-xl border-[1.5px] border-dashed p-[18px] text-center transition-colors max-md:min-h-20 max-md:justify-center",
        over ? "border-primary bg-accent" : "border-input bg-background hover:bg-muted/40",
      )}
    >
      <span className="text-sm">
        <b className="font-medium">Choose files</b>
        <span className="max-md:hidden">, {prompt}</span>
      </span>
      <span className="text-xs text-muted-foreground">{PLAN_ATTACHMENT_ACCEPT_HINT}</span>
      <input
        id={inputId}
        type="file"
        multiple
        className="sr-only"
        aria-label={ariaLabel}
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (picked.length) onFiles(picked);
        }}
      />
    </label>
  );
}
