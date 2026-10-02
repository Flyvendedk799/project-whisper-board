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
 * On a phone it sits above the Report button (and above that again when the
 * running-timer bar has lifted it), so neither covers the other.
 */
export function AssistantRoot({ raised = false }: { raised?: boolean }) {
  const { enabled, isOpen, toggle } = useAssistant();
  if (!enabled) return null;

  return (
    <>
      {isOpen && <AssistantPanel />}
      <Button
        size="icon"
        onClick={toggle}
        aria-label={isOpen ? "Close assistant" : "Open assistant"}
        aria-expanded={isOpen}
        title="Assistant"
        className={cn(
          "fixed right-5 z-40 h-12 w-12 rounded-full shadow-lg md:bottom-5",
          raised ? "bottom-[10.25rem]" : "bottom-[5.75rem]",
        )}
      >
        {isOpen ? (
          <X className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        )}
      </Button>
    </>
  );
}
