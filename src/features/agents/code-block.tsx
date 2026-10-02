import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

/** A snippet you are meant to paste somewhere: monospace, scrolls sideways, one Copy button. */
export function CodeBlock({
  code,
  caption,
  className,
}: {
  code: string;
  caption?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[14px] border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <span className="truncate text-xs text-muted-foreground">{caption ?? "Snippet"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
