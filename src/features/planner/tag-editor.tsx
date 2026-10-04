import { useId, useState } from "react";
import { X } from "lucide-react";
import { MAX_TAGS, normalizeTag } from "@/lib/plan-fields";
import { cn } from "@/lib/utils";

/** A tag as shown on cards and in the drawer. Clickable when it can filter. */
export function TagChip({
  tag,
  onClick,
  onRemove,
  active = false,
  className,
}: {
  tag: string;
  onClick?: () => void;
  onRemove?: () => void;
  active?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <span aria-hidden="true">#</span>
      {tag}
    </>
  );
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 rounded-full border bg-muted/50 px-1.5 py-px text-[11px] leading-snug text-muted-foreground",
        onRemove && "max-md:pl-2.5 max-md:text-xs",
        active && "border-primary bg-accent text-foreground",
        className,
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          className="truncate hover:text-foreground focus-visible:outline-none focus-visible:underline"
          title={`Filter by #${tag}`}
        >
          {body}
        </button>
      ) : (
        <span className="truncate">{body}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove tag ${tag}`}
          onClick={onRemove}
          className="rounded-full hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:-my-2.5 max-md:-mr-2 max-md:grid max-md:h-10 max-md:w-10 max-md:place-items-center"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

/**
 * Tags as chips with an input: Enter or comma adds, Backspace on an empty
 * input removes the last. Suggestions come from tags already on the plan.
 */
export function TagEditor({
  tags,
  onChange,
  suggestions = [],
  label,
  placeholder = "Add a tag, press Enter",
}: {
  tags: readonly string[];
  onChange: (tags: string[]) => void;
  suggestions?: readonly string[];
  label: string;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const listId = useId();
  const atLimit = tags.length >= MAX_TAGS;

  const commit = (raw: string) => {
    const tag = normalizeTag(raw);
    setText("");
    if (!tag || tags.includes(tag) || atLimit) return;
    onChange([...tags, tag]);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1 max-md:gap-2">
          {tags.map((tag) => (
            <TagChip key={tag} tag={tag} onRemove={() => onChange(tags.filter((t) => t !== tag))} />
          ))}
        </div>
      ) : null}
      <input
        value={text}
        list={listId}
        aria-label={label}
        disabled={atLimit}
        placeholder={atLimit ? `Up to ${MAX_TAGS} tags` : placeholder}
        onChange={(event) => {
          const value = event.target.value;
          if (value.endsWith(",")) commit(value);
          else setText(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(text);
          } else if (event.key === "Backspace" && !text && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && commit(text)}
        maxLength={40}
        autoCapitalize="none"
        autoCorrect="off"
        enterKeyHint="done"
        className="h-9 rounded-md border bg-card px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 max-md:h-11"
      />
      <datalist id={listId}>
        {suggestions
          .filter((tag) => !tags.includes(tag))
          .slice(0, 20)
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
    </div>
  );
}
