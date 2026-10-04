import { useEffect, useState } from "react";

/**
 * True while a text field has focus — which on a phone means the on-screen
 * keyboard is up and the bottom bar would sit on top of it (or squash the page).
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isTextField = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      if (el instanceof HTMLTextAreaElement) return true;
      if (el instanceof HTMLInputElement) {
        return !["checkbox", "radio", "button", "submit", "range", "file", "color"].includes(
          el.type,
        );
      }
      return false;
    };
    const onIn = (event: FocusEvent) => {
      if (!isTextField(event.target)) return;
      clearTimeout(timer);
      setOpen(true);
    };
    const onOut = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setOpen(false), 120);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  return open;
}
