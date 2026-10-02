import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchableOption = {
  value: string;
  label?: string;
  /** Smaller text after the label: "private", a default branch, a description. */
  hint?: string;
};

/**
 * A dropdown you can type in. Replaces a plain Select wherever the list can be
 * long (repositories, branches): the list filters as you type, and with
 * `allowCustom` a value that is not in the list can still be used.
 */
export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "Nothing matches.",
  ariaLabel,
  loading = false,
  allowCustom = false,
  validateCustom,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SearchableOption[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel: string;
  loading?: boolean;
  /** Offer the typed text as a choice when it is not in the list. */
  allowCustom?: boolean;
  /** Only offer the typed text when this accepts it. */
  validateCustom?: (text: string) => boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const typed = search.trim();
  const known = useMemo(
    () => options.some((option) => option.value.toLowerCase() === typed.toLowerCase()),
    [options, typed],
  );
  const offerCustom =
    allowCustom && typed.length > 0 && !known && (validateCustom?.(typed) ?? true);
  const selected = options.find((option) => option.value === value);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn("h-10 w-full justify-between bg-background px-3 font-normal", className)}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {selected?.label ?? (value || placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          <CommandList>
            {loading ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : (
              <>
                <CommandEmpty>{offerCustom ? null : emptyText}</CommandEmpty>
                <CommandGroup>
                  {offerCustom ? (
                    <CommandItem value={`__custom__ ${typed}`} onSelect={() => choose(typed)}>
                      Use &ldquo;{typed}&rdquo;
                    </CommandItem>
                  ) : null}
                  {options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={`${option.value} ${option.label ?? ""} ${option.hint ?? ""}`}
                      onSelect={() => choose(option.value)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4 shrink-0",
                          option.value === value ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {option.label ?? option.value}
                      </span>
                      {option.hint ? (
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                          {option.hint}
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
