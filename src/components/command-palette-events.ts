export const OPEN_EVENT = "boared:open-command-palette";

/** Lets the sidebar's "Search or jump to…" button open the palette. */
export function openCommandPalette() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_EVENT));
}
