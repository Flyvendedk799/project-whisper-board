"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Below `md` a dialog is a bottom sheet: anchored to the bottom edge, rounded on
 * top, capped to the dynamic viewport so the on-screen keyboard cannot push it
 * off-screen, scrollable inside, padded for the home indicator, and dismissed by
 * dragging the handle down. From `md` up it is the centred dialog it always was.
 */
export const DIALOG_SHEET_CLASS =
  "max-md:inset-x-0 max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:max-h-[92dvh] max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-b-none max-md:rounded-t-2xl max-md:border-x-0 max-md:border-b-0 max-md:px-5 max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] max-md:pt-9 max-md:data-[state=open]:slide-in-from-bottom max-md:data-[state=closed]:slide-out-to-bottom max-md:data-[state=open]:zoom-in-100 max-md:data-[state=closed]:zoom-out-100 max-md:data-[state=open]:duration-300 max-md:data-[state=closed]:duration-200";

const DIALOG_DISMISS_DISTANCE = 110;

/** The grab handle: dragging it down past a threshold closes the sheet. */
export function SheetHandle({
  targetRef,
  onDismiss,
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  onDismiss: () => void;
}) {
  const start = React.useRef<{ y: number; t: number } | null>(null);

  const reset = (animate: boolean) => {
    const el = targetRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 180ms ease-out" : "";
    el.style.transform = "";
  };

  return (
    <div
      aria-hidden="true"
      data-sheet-handle=""
      className="absolute inset-x-0 top-0 z-10 flex h-9 touch-none cursor-grab justify-center pt-2.5 md:hidden"
      onPointerDown={(e) => {
        start.current = { y: e.clientY, t: e.timeStamp };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dy = Math.max(0, e.clientY - start.current.y);
        const el = targetRef.current;
        if (el) {
          el.style.transition = "none";
          el.style.transform = `translateY(${dy}px)`;
        }
      }}
      onPointerUp={(e) => {
        const begun = start.current;
        start.current = null;
        if (!begun) return;
        const dy = e.clientY - begun.y;
        const velocity = dy / Math.max(1, e.timeStamp - begun.t);
        if (dy > DIALOG_DISMISS_DISTANCE || (dy > 40 && velocity > 0.6)) onDismiss();
        else reset(true);
      }}
      onPointerCancel={() => {
        start.current = null;
        reset(true);
      }}
    >
      <span className="h-1 w-10 rounded-full bg-muted-foreground/30" />
    </div>
  );
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref],
  );

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setRefs}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 md:rounded-lg",
          DIALOG_SHEET_CLASS,
          className,
        )}
        {...props}
      >
        <SheetHandle targetRef={innerRef} onDismiss={() => closeRef.current?.click()} />
        {children}
        <DialogPrimitive.Close
          ref={closeRef}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground max-md:right-2 max-md:top-2 max-md:z-20 max-md:grid max-md:h-11 max-md:w-11 max-md:place-items-center max-md:rounded-full"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center max-md:pr-8 max-md:text-left sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
