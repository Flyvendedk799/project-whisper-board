import { Check } from "lucide-react";
import { COLOR_PALETTE, colorLabel } from "@/lib/plan-fields";
import { cn } from "@/lib/utils";

/** A row of swatches. Choosing the selected one again, or "Default", clears it. */
export function ColorPicker({
  value,
  onChange,
  label,
  className,
}: {
  value: string | null | undefined;
  onChange: (color: string | null) => void;
  /** Names the group for assistive tech: "Task colour". */
  label: string;
  className?: string;
}) {
  const known = COLOR_PALETTE.some((entry) => entry.value.toLowerCase() === value?.toLowerCase());
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-1.5 max-md:gap-2", className)}
    >
      <button
        type="button"
        aria-pressed={!value}
        title="Default colour"
        onClick={() => onChange(null)}
        className={cn(
          "h-6 rounded-full border px-2 text-[11px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10 max-md:px-3.5 max-md:text-xs",
          !value && "border-primary bg-accent text-foreground",
        )}
      >
        Default
      </button>
      {COLOR_PALETTE.map((entry) => {
        const selected = value?.toLowerCase() === entry.value.toLowerCase();
        return (
          <button
            key={entry.id}
            type="button"
            aria-pressed={selected}
            aria-label={entry.label}
            title={entry.label}
            onClick={() => onChange(selected ? null : entry.value)}
            style={{ backgroundColor: entry.value }}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10 max-md:w-10",
              selected && "ring-2 ring-foreground/60",
            )}
          >
            {selected ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          </button>
        );
      })}
      {value && !known ? (
        <span
          title={colorLabel(value)}
          aria-label={`${colorLabel(value)} colour in use`}
          style={{ backgroundColor: value }}
          className="h-6 w-6 rounded-full ring-2 ring-foreground/60 ring-offset-2 ring-offset-background max-md:h-10 max-md:w-10"
        />
      ) : null}
    </div>
  );
}
