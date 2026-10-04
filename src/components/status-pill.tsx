import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared presentational primitives used across every screen of the redesign.
 * `app-shell.tsx` re-exports these names so older imports keep working.
 */

export type Tone = "default" | "success" | "warning" | "info" | "destructive";

const TONE_CLASS: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
  destructive: "bg-destructive/15 text-destructive",
};

export function StatusPill({
  children,
  tone = "default",
  className = "",
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  /** Optional. The redesign prefers a serif headline, one sentence and one action. */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-12 text-center max-md:px-4 max-md:py-9">
      {Icon ? (
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent">
          <Icon className="h-6 w-6 text-primary" aria-hidden />
        </div>
      ) : null}
      <h3 className="font-display text-2xl">{title}</h3>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

/** A labelled bar with the semantics the raw div it replaces never had. */
export function ProgressBar({
  value,
  label,
  className = "",
  showValue = false,
}: {
  value: number;
  label: string;
  className?: string;
  /** Renders the numeric label beside the bar (the design always pairs them). */
  showValue?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const bar = (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`h-1.5 overflow-hidden rounded-full bg-muted ${showValue ? "flex-1" : ""} ${className}`}
    >
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
  if (!showValue) return bar;
  return (
    <div className="flex items-center gap-2">
      {bar}
      <span className="text-xs tabular-nums text-muted-foreground">{clamped}%</span>
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
}

/** Two-to-four way switch: List/Board, Agency/Client, Password/Magic link. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex rounded-lg max-md:max-w-full bg-muted p-[3px] ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-label={o.ariaLabel}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-3.5 text-sm transition-colors ${
              size === "sm" ? "h-7 text-xs" : "h-7 sm:h-7"
            } max-md:h-9 ${
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
