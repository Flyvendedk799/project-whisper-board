import { useEffect, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The one way to ask "really delete this?".
 *
 * Deleting is permanent here, so the dialog says what goes with the thing, and
 * for anything that holds real work it asks for the name to be typed first.
 * The delete button is a plain button rather than `AlertDialogAction`, which
 * would close the dialog the moment it is pressed: the caller closes it when
 * the server says the delete happened, and until then it stays up, busy.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel = "Delete",
  busyLabel = "Deleting…",
  busy = false,
  confirmText,
  blocked = false,
  disabled = false,
  extraAction,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will be lost. Rendered under the title. */
  children: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  /** When set, the delete button stays off until this exact text is typed. */
  confirmText?: string;
  /** The delete cannot go ahead (the reason is in `children`). */
  blocked?: boolean;
  /** Hold the delete button off for now, for example while the impact is still loading. */
  disabled?: boolean;
  /** A gentler alternative, such as "Archive instead". */
  extraAction?: ReactNode;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const matches = !confirmText || typed.trim() === confirmText.trim();

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">{children}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {confirmText && !blocked ? (
          <form
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (matches && !busy) onConfirm();
            }}
          >
            <Label htmlFor="confirm-delete-input" className="text-[13px] font-normal">
              Type <span className="font-semibold text-foreground">{confirmText}</span> to confirm
            </Label>
            <Input
              id="confirm-delete-input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="go"
              autoFocus
              disabled={busy}
            />
          </form>
        ) : null}

        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {extraAction}
          {blocked ? null : (
            <Button
              type="button"
              variant="destructive"
              disabled={busy || disabled || !matches}
              onClick={onConfirm}
            >
              {busy ? busyLabel : confirmLabel}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
