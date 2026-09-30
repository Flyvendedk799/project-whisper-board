/**
 * The redesign's "section": a serif title with an optional terracotta action,
 * then one white card of hairline-separated rows.
 */
export function Section({
  title,
  action,
  children,
  id,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section aria-labelledby={title && id ? id : undefined}>
      {title ? (
        <div className="mb-2.5 flex items-center">
          <h2 id={id} className="flex-1 font-display text-[22px] font-normal leading-tight">
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SectionAction({ children }: { children: React.ReactNode }) {
  return <span className="text-[13px] text-primary">{children}</span>;
}

export function RowCard({ children }: { children: React.ReactNode }) {
  return (
    <ul className="overflow-hidden rounded-[14px] border bg-card [&>li+li]:border-t">{children}</ul>
  );
}

const ROW_CLASS =
  "flex items-center gap-3 px-4 py-[13px] transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** One row of a `RowCard`. Pass `to` (+ params/search) to make it a link. */
export function SectionRow({
  title,
  sub,
  pill,
  right,
  progress,
  link,
  compact = false,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  pill?: React.ReactNode;
  right?: React.ReactNode;
  /** 0-100; draws the thin bar under the text. */
  progress?: number;
  /**
   * Renders the row as a router link, e.g.
   * `link={(p) => <Link to="/app/time" {...p} />}`. Typed this way so the
   * caller keeps TanStack's route-checked `to`, `params` and `search`.
   */
  link?: (props: { className: string; children: React.ReactNode }) => React.ReactElement;
  compact?: boolean;
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`min-w-0 truncate font-medium leading-snug ${compact ? "text-[13px]" : "text-sm"}`}
          >
            {title}
          </span>
          {pill}
        </div>
        {sub ? (
          <div className="mt-0.5 truncate text-[13px] leading-snug text-muted-foreground">
            {sub}
          </div>
        ) : null}
        {progress !== undefined ? (
          <div
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress"
            className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        ) : null}
      </div>
      {right ? (
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{right}</span>
      ) : null}
    </>
  );

  return (
    <li>
      {link ? (
        link({ className: ROW_CLASS, children: body })
      ) : (
        <div className={ROW_CLASS.replace("hover:bg-surface ", "")}>{body}</div>
      )}
    </li>
  );
}
