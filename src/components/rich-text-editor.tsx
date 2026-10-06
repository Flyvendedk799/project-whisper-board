import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, List, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MentionNode } from "@/components/rich-text-mention";
import { MentionPicker, type MentionCandidate } from "@/components/mention-input";
import {
  filterMentionCandidates,
  mentionKeyDown,
  mentionLabel,
  mentionQueryAt,
} from "@/lib/mentions";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  id?: string;
  /** Offer these people after "@". Without it, @ is just a character. */
  mentionPeople?: readonly MentionCandidate[];
  /** Left out of the picker; usually yourself. */
  mentionExcludeId?: string | null;
};

type MentionRange = { query: string; from: number; to: number };

/** The "@query" right before the caret, as a document range. */
function mentionRangeAt(editor: Editor): MentionRange | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock) return null;
  // Atoms (like an existing mention) read as one placeholder character.
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const found = mentionQueryAt(before, before.length);
  if (!found) return null;
  return { query: found.query, from: $from.pos - (before.length - found.start), to: $from.pos };
}

/** TipTap composer. Stores HTML; empty editor yields "". */
export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write something…",
  className,
  minHeight = "6rem",
  id,
  mentionPeople,
  mentionExcludeId,
}: Props) {
  const listId = useId();
  const [range, setRange] = useState<MentionRange | null>(null);
  const [active, setActive] = useState(0);
  const candidates = useMemo(
    () =>
      range && mentionPeople
        ? filterMentionCandidates(mentionPeople, range.query, { excludeId: mentionExcludeId })
        : [],
    [range, mentionPeople, mentionExcludeId],
  );

  // The editor's key handler is created once; it reads the picker through refs.
  const picker = useRef({ candidates, active, range });
  picker.current = { candidates, active, range };
  const mentionsOn = useRef(Boolean(mentionPeople));
  mentionsOn.current = Boolean(mentionPeople);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
      MentionNode,
    ],
    content: value || "",
    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? "" : ed.getHTML();
      onChange(html);
      if (mentionsOn.current) {
        setRange(mentionRangeAt(ed));
        setActive(0);
      }
    },
    onSelectionUpdate: ({ editor: ed }) => {
      if (mentionsOn.current) setRange(mentionRangeAt(ed));
    },
    onBlur: () => setRange(null),
    editorProps: {
      handleKeyDown: (_view, event) => {
        const { candidates: list, active: index } = picker.current;
        const used = mentionKeyDown(
          event.key,
          { open: list.length > 0, count: list.length, active: index },
          {
            move: setActive,
            pick: () => {
              const person = list[index];
              if (person) insertMentionRef.current(person);
            },
            close: () => setRange(null),
          },
        );
        if (used) event.preventDefault();
        return used;
      },
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[var(--rte-min)] px-3 py-2 focus:outline-none max-md:min-h-[var(--rte-min-mobile)] max-md:px-3.5 max-md:py-3",
        ...(id ? { id } : {}),
        style: `--rte-min: ${minHeight}; --rte-min-mobile: max(${minHeight}, 8rem)`,
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (value !== current && !editor.isFocused) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [editor, value]);

  const insertMention = (person: MentionCandidate) => {
    const current = picker.current.range;
    if (!editor || !current) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: current.from, to: current.to }, [
        { type: "mention", attrs: { id: person.id, label: mentionLabel(person) } },
        { type: "text", text: " " },
      ])
      .run();
    setRange(null);
  };
  const insertMentionRef = useRef(insertMention);
  insertMentionRef.current = insertMention;

  if (!editor) return null;

  const open = candidates.length > 0;

  return (
    <div className={cn("relative rounded-md border bg-background", className)}>
      <div className="flex flex-wrap gap-0.5 border-b px-1 py-1 max-md:flex-nowrap max-md:gap-1 max-md:overflow-x-auto max-md:overscroll-x-contain max-md:no-scrollbar">
        <ToolbarButton
          label="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>
      <EditorContent
        editor={editor}
        role={mentionPeople ? "combobox" : undefined}
        aria-expanded={mentionPeople ? open : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
      />
      {mentionPeople ? (
        <MentionPicker
          id={listId}
          candidates={candidates}
          activeIndex={active}
          onPick={insertMention}
          onHover={setActive}
        />
      ) : null}
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7 max-md:shrink-0", active && "bg-accent")}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
