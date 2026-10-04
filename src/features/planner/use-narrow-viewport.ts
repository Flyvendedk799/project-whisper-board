import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(QUERY).matches
    : false;
}

/**
 * True below the `md` breakpoint. Read synchronously (no first-paint flash of
 * the desktop layout), so a screen can render one structure per viewport.
 */
export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
