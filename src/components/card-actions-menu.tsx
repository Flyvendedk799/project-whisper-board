import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The "…" on a list card: archive or restore it, or delete it.
 *
 * It sits over the card's corner rather than inside the card's link, so opening
 * the menu never navigates. The caller owns what the actions do, including the
 * confirmation that delete needs.
 */
export function CardActionsMenu({
  label,
  archived,
  busy = false,
  onArchive,
  onRestore,
  onDelete,
  className,
}: {
  /** Names the card for screen readers: "Actions for Acme storefront". */
  label: string;
  archived: boolean;
  busy?: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${label}`}
          disabled={busy}
          className={cn("absolute right-2.5 top-2.5 h-8 w-8 text-muted-foreground", className)}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {archived ? (
          <DropdownMenuItem onSelect={onRestore}>Restore</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onArchive}>Archive</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
          Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
