import { Fragment, useMemo } from "react";
import { splitMentions } from "@/lib/mentions";
import { cn } from "@/lib/utils";

/**
 * Plain text with its `@[Name](user:<id>)` tokens shown as chips. A current
 * name, when the caller knows it, wins over the one saved in the token, so a
 * rename shows up everywhere.
 */
export function MentionText({
  text,
  names,
  className,
}: {
  text: string;
  /** Current display names by user id. */
  names?: ReadonlyMap<string, string>;
  className?: string;
}) {
  const segments = useMemo(() => splitMentions(text), [text]);
  if (segments.length === 1 && segments[0]!.type === "text") {
    return <span className={className}>{text}</span>;
  }
  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          <Fragment key={index}>{segment.text}</Fragment>
        ) : (
          <MentionChip
            key={index}
            id={segment.id}
            label={names?.get(segment.id) ?? segment.label}
          />
        ),
      )}
    </span>
  );
}

export function MentionChip({
  id,
  label,
  className,
}: {
  id: string;
  label: string;
  className?: string;
}) {
  return (
    <span data-type="mention" data-id={id} className={cn(className)}>
      @{label}
    </span>
  );
}
