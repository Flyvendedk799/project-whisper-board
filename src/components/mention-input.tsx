import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Textarea } from "@/components/ui/textarea";
import { PersonAvatar, personName } from "@/components/person-avatar";
import {
  encodeMentions,
  filterMentionCandidates,
  mentionLabel,
  mentionKeyDown,
  mentionQueryAt,
  type MentionPerson,
} from "@/lib/mentions";
import { cn } from "@/lib/utils";

/** Someone who can be mentioned: a workspace member. */
export type MentionCandidate = MentionPerson & {
  avatar_url?: string | null;
  pending?: boolean;
  role?: string | null;
};

/**
 * The list under a composer while an @mention is being typed. Rendered by the
 * plain-text composer below and by the rich-text editor; neither moves focus
 * into it, so typing carries on and the arrow keys drive the selection.
 */
export function MentionPicker({
  id,
  candidates,
  activeIndex,
  onPick,
  onHover,
  className,
}: {
  id: string;
  candidates: readonly MentionCandidate[];
  activeIndex: number;
  onPick: (person: MentionCandidate) => void;
  onHover: (index: number) => void;
  className?: string;
}) {
  if (candidates.length === 0) return null;
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Mention a teammate"
      className={cn(
        "absolute bottom-full left-0 z-30 mb-1 max-h-56 w-full max-w-sm overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md max-md:static max-md:mb-0 max-md:mt-1.5 max-md:max-w-none",
        className,
      )}
    >
      {candidates.map((person, index) => (
        <li
          key={person.id}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          // mousedown, not click: a click would blur the composer first.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(person);
          }}
          onMouseEnter={() => onHover(index)}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm max-md:min-h-11",
            index === activeIndex && "bg-accent text-accent-foreground",
          )}
        >
          <PersonAvatar person={person} size="sm" pending={person.pending} />
          <span className="min-w-0 flex-1 truncate font-medium">{personName(person)}</span>
          {person.pending ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">Pending</span>
          ) : person.full_name && person.email ? (
            <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
              {person.email}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export interface MentionTextareaHandle {
  /** The text with each picked `@Name` turned into its stored token. */
  encoded: () => string;
  /** Forget who was picked, after sending. */
  reset: () => void;
  focus: () => void;
  textarea: HTMLTextAreaElement | null;
}

type TextareaProps = Omit<React.ComponentProps<"textarea">, "value" | "onChange" | "ref">;

/**
 * A textarea that offers teammates after "@". The text shows `@Ada Lovelace`;
 * `encoded()` gives the version to store, with `@[Ada Lovelace](user:<id>)` for
 * each person actually picked (a name merely typed is just text).
 */
export const MentionTextarea = forwardRef<
  MentionTextareaHandle,
  TextareaProps & {
    value: string;
    onValueChange: (value: string) => void;
    people: readonly MentionCandidate[];
    /** Usually yourself. */
    excludeId?: string | null;
    pickerClassName?: string;
    /** Classes for the wrapper, which holds the textarea and the picker. */
    wrapperClassName?: string;
    /** Also receives the textarea element, e.g. for a paste handler elsewhere. */
    textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  }
>(function MentionTextarea(
  {
    value,
    onValueChange,
    people,
    excludeId,
    pickerClassName,
    wrapperClassName,
    textareaRef,
    onKeyDown,
    onBlur,
    className,
    ...props
  },
  ref,
) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const listId = useId();
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<MentionCandidate[]>([]);

  const candidates = useMemo(
    () => (query ? filterMentionCandidates(people, query.query, { excludeId }) : []),
    [people, query, excludeId],
  );
  const open = candidates.length > 0;

  useImperativeHandle(
    ref,
    () => ({
      encoded: () => encodeMentions(value, picked),
      reset: () => {
        setPicked([]);
        setQuery(null);
      },
      focus: () => inner.current?.focus(),
      get textarea() {
        return inner.current;
      },
    }),
    [value, picked],
  );

  const sync = useCallback((text: string, caret: number) => {
    setQuery(mentionQueryAt(text, caret));
    setActive(0);
  }, []);

  const pick = (person: MentionCandidate) => {
    if (!query) return;
    const label = mentionLabel(person);
    const caret = inner.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, query.start)}@${label} ${value.slice(caret)}`;
    const nextCaret = query.start + label.length + 2;
    onValueChange(next);
    setPicked((current) =>
      current.some((p) => p.id === person.id) ? current : [...current, person],
    );
    setQuery(null);
    requestAnimationFrame(() => {
      inner.current?.focus();
      inner.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  return (
    <div className={cn("relative", wrapperClassName)}>
      <Textarea
        {...props}
        ref={(element) => {
          inner.current = element;
          if (textareaRef) textareaRef.current = element;
        }}
        value={value}
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          onValueChange(event.target.value);
          sync(event.target.value, event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={(event) => {
          const target = event.currentTarget;
          sync(target.value, target.selectionStart ?? target.value.length);
        }}
        onKeyDown={(event) => {
          const used = mentionKeyDown(
            event.key,
            { open, count: candidates.length, active },
            {
              move: setActive,
              pick: () => {
                const person = candidates[active];
                if (person) pick(person);
              },
              close: () => setQuery(null),
            },
          );
          if (used) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onKeyDown?.(event);
        }}
        onBlur={(event) => {
          setQuery(null);
          onBlur?.(event);
        }}
      />
      <MentionPicker
        id={listId}
        candidates={candidates}
        activeIndex={active}
        onPick={pick}
        onHover={setActive}
        className={pickerClassName}
      />
    </div>
  );
});
