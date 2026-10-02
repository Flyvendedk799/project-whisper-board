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
 * A list card's own controls, in one row over its top-right corner and outside the card's link,
 * so using one never navigates. Put a card's controls here together, with the "…" menu last and
 * `inline`: two controls placed separately end up on top of each other, or on the card's text.
 * The card reserves the room for them (about 3.5rem for the copy button and the menu).
 */
export function CardCorner({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute right-2.5 top-3.5 z-10 flex h-8 items-center gap-1">{children}</div>
  );
}

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
  inline = false,
  onArchive,
  onRestore,
  onDelete,
  className,
}: {
  /** Names the card for screen readers: "Actions for Acme storefront". */
  label: string;
  archived: boolean;
  busy?: boolean;
  /** Sits in a `CardCorner` next to other controls instead of positioning itself. */
  inline?: boolean;
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
          className={cn(
            "h-8 w-8 text-muted-foreground",
            !inline && "absolute right-2.5 top-2.5",
            className,
          )}
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
