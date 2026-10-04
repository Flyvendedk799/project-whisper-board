import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Click to copy an object's id. Plans, sections and tasks all have one, and an
 * id is what an agent should be given instead of a title that may be reworded.
 * Safe inside a draggable or clickable card: it never bubbles.
 */
export function CopyIdButton({
  id,
  label,
  showId = false,
  className,
}: {
  id: string;
  /** "task", "section" or "plan": used in the tooltip and the toast. */
  label: string;
  /** Show the first block of the id next to the icon. */
  showId?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    event.preventDefault();
    navigator.clipboard
      .writeText(id)
      .then(() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
        toast.success(`Copied ${label} id`);
      })
      .catch(() => toast.error("Couldn't copy the id"));
  };

  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      title={`Copy ${label} id`}
      aria-label={`Copy ${label} id`}
      onClick={copy}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:relative max-md:after:absolute max-md:after:-inset-3 max-md:after:content-['']",
        copied && "text-success",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {showId ? <span className="font-mono text-[11px]">{id.slice(0, 8)}</span> : null}
    </button>
  );
}
