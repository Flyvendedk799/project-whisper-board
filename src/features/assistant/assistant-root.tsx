import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AssistantPanel } from "./assistant-panel";
import { useAssistant } from "./assistant-provider";

/**
 * The floating button in the bottom-right corner, and the panel it opens.
 * Mounted once in the app shell, inside `AssistantProvider`. Renders nothing
 * unless AI is set up.
 *
 * On a phone it sits above the bottom tab bar (and above that again when the
 * running-timer bar is up), so neither covers the other.
 */
export function AssistantRoot({
  hidden = false,
}: {
  /** Phone only: the bottom bar is away (keyboard up, or a focused flow), so is the button. */
  hidden?: boolean;
}) {
  const { enabled, isOpen, toggle } = useAssistant();
  if (!enabled) return null;

  return (
    <>
      {isOpen && <AssistantPanel />}
      {hidden && !isOpen ? null : (
        <Button
          size="icon"
          onClick={toggle}
          aria-label={isOpen ? "Close assistant" : "Open assistant"}
          aria-expanded={isOpen}
          title="Assistant"
          className={cn(
            "fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full shadow-lg max-md:bottom-[calc(var(--mobile-tabbar-h)+var(--mobile-timer-h)+0.75rem)] max-md:right-4 max-md:h-12 max-md:w-12",
          )}
        >
          {isOpen ? (
            <X className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          )}
        </Button>
      )}
    </>
  );
}
