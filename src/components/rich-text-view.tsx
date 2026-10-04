import { cn } from "@/lib/utils";

/**
 * Renders ticket/comment HTML from TipTap. Plain text falls back to pre-wrap
 * so older rows without markup still read correctly.
 */
export function RichTextView({
  html,
  className,
}: {
  html: string | null | undefined;
  className?: string;
}) {
  if (!html?.trim()) return null;

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(html);

  if (!looksLikeHtml) {
    return (
      <p
        className={cn("whitespace-pre-wrap text-sm leading-relaxed max-md:break-words", className)}
      >
        {html}
      </p>
    );
  }

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 max-md:break-words max-md:[&_img]:h-auto max-md:[&_img]:max-w-full max-md:[&_pre]:overflow-x-auto max-md:[&_table]:block max-md:[&_table]:overflow-x-auto",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
