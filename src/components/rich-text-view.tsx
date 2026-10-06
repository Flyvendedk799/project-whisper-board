import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { MentionText } from "@/components/mention-text";

/**
 * Renders ticket/comment HTML from TipTap. Plain text falls back to pre-wrap
 * so older rows without markup still read correctly.
 *
 * The HTML is cleaned first (see `sanitize-html`): it can come from the API or
 * an AI draft as well as the editor, and it is shown to everyone on the project.
 */
export function RichTextView({
  html,
  className,
}: {
  html: string | null | undefined;
  className?: string;
}) {
  const looksLikeHtml = Boolean(html && /<\/?[a-z][\s\S]*>/i.test(html));
  const safe = useMemo(
    () => (html && looksLikeHtml ? sanitizeHtml(html) : ""),
    [html, looksLikeHtml],
  );

  if (!html?.trim()) return null;

  if (!looksLikeHtml) {
    return (
      <p
        className={cn("whitespace-pre-wrap text-sm leading-relaxed max-md:break-words", className)}
      >
        <MentionText text={html} />
      </p>
    );
  }

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 max-md:break-words max-md:[&_img]:h-auto max-md:[&_img]:max-w-full max-md:[&_pre]:overflow-x-auto max-md:[&_table]:block max-md:[&_table]:overflow-x-auto",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
