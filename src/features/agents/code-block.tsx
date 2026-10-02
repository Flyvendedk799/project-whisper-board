import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadText } from "./download";

/** Copies text and says so; the browser may refuse, in which case the person is told to do it by hand. */
export function CopyButton({
  text,
  label = "Copy",
  size = "sm",
  className,
}: {
  text: string;
  label?: string;
  size?: "sm" | "default";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      onClick={() =>
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            toast.success("Copied");
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => toast.error("Couldn't copy. Select the text and copy it by hand."))
      }
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** A file the snippet can also be saved as. */
export interface CodeDownload {
  filename: string;
  type?: string;
}

/** A snippet you are meant to paste somewhere: monospace, scrolls sideways, one Copy button. */
export function CodeBlock({
  code,
  caption,
  download,
  className,
}: {
  code: string;
  caption?: string;
  /** Also offer the snippet as a file with this name, e.g. `mcp.json`. */
  download?: CodeDownload;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[14px] border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <span className="truncate text-xs text-muted-foreground">{caption ?? "Snippet"}</span>
        <div className="flex shrink-0 gap-2">
          {download ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadText(download.filename, code, download.type)}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {download.filename}
            </Button>
          ) : null}
          <CopyButton text={code} />
        </div>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
