import { useEffect, useRef } from "react";

/**
 * Keyboard shortcuts, from one listener.
 *
 * Two rules that matter more than the bindings themselves: a shortcut must
 * never fire while someone is typing, and a chord like `g t` must not swallow
 * the `t` if they were just slow. Both are handled here so no individual
 * shortcut has to remember.
 */

export type Handler = (event: KeyboardEvent) => void;
export type Bindings = Record<string, Handler>;

/** How long a `g`-prefixed chord stays armed. */
const CHORD_TIMEOUT_MS = 1200;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    Boolean(target.closest('[role="dialog"], [role="textbox"], [contenteditable="true"]'))
  );
}

/** Normalised description of a key press: "g", "shift+j", "mod+k". */
export function describeEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey && event.key.length > 1) parts.push("shift");
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  return parts.join("+");
}

export interface HotkeyOptions {
  /** Set false to suspend, e.g. while a modal owns the keyboard. */
  enabled?: boolean;
  /** Allow these even while typing — "mod+k" and "Escape" usually should. */
  allowWhileTyping?: string[];
}

export function useHotkeys(bindings: Bindings, options: HotkeyOptions = {}) {
  const { enabled = true, allowWhileTyping = ["mod+k", "Escape"] } = options;

  // Kept in a ref so changing a handler does not re-register the listener and
  // lose a chord that is mid-flight.
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const allowRef = useRef(allowWhileTyping);
  allowRef.current = allowWhileTyping;

  const pendingChord = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const description = describeEvent(event);
      const typing = isTyping(event.target);
      if (typing && !allowRef.current.includes(description)) return;

      // Continue a chord if one is armed and still fresh.
      const pending = pendingChord.current;
      if (pending && Date.now() - pending.at < CHORD_TIMEOUT_MS) {
        pendingChord.current = null;
        const chord = `${pending.key} ${description}`;
        const chordHandler = bindingsRef.current[chord];
        if (chordHandler) {
          event.preventDefault();
          chordHandler(event);
          return;
        }
        // Not a chord after all — fall through and treat it as a single key.
      } else {
        pendingChord.current = null;
      }

      // Arm a chord if anything is registered with this prefix.
      const isPrefix = Object.keys(bindingsRef.current).some((key) =>
        key.startsWith(`${description} `),
      );
      if (isPrefix) {
        pendingChord.current = { key: description, at: Date.now() };
        event.preventDefault();
        return;
      }

      const handler = bindingsRef.current[description];
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/** Shown in the shortcut sheet, and the single source for what exists. */
export const SHORTCUTS: Array<{ keys: string; label: string; group: string }> = [
  { keys: "⌘K", label: "Search and run anything", group: "Everywhere" },
  { keys: "?", label: "Show this list", group: "Everywhere" },
  { keys: "g h", label: "Home", group: "Go to" },
  { keys: "g t", label: "Triage queue", group: "Go to" },
  { keys: "g p", label: "Projects", group: "Go to" },
  { keys: "g i", label: "Inbox", group: "Go to" },
  { keys: "g s", label: "Settings", group: "Go to" },
  { keys: "c", label: "Report something", group: "Actions" },
  { keys: "/", label: "Search the queue", group: "Queue" },
  { keys: "j / k", label: "Move down and up", group: "Queue" },
  { keys: "x", label: "Select the highlighted ticket", group: "Queue" },
  { keys: "Enter", label: "Open the highlighted ticket", group: "Queue" },
  { keys: "Esc", label: "Clear the selection", group: "Queue" },
];
