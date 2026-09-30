import { NotificationBell } from "@/components/notification-bell";

export interface PageHeaderTab {
  id: string;
  label: React.ReactNode;
  active: boolean;
  onSelect: () => void;
}

/**
 * Serif title, one-line description, actions on the right and an optional tabs
 * row with a 2px terracotta underline. Sticky with a blur.
 * `action` is kept for existing callers; `actions` is an alias.
 */
export function PageHeader({
  title,
  description,
  action,
  actions,
  back,
  meta,
  tabs,
  maxWidth = "max-w-6xl",
  bell = true,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  actions?: React.ReactNode;
  /** Small "← Projects" style link rendered above the title. */
  back?: React.ReactNode;
  /** Row under the description (pills, progress, links). */
  meta?: React.ReactNode;
  tabs?: PageHeaderTab[];
  maxWidth?: string;
  bell?: boolean;
}) {
  return (
    <div className="sticky top-14 z-20 border-b bg-background/90 backdrop-blur md:top-0">
      <div className={`mx-auto px-4 pt-4 md:px-8 md:pt-6 ${maxWidth}`}>
        {back ? <div className="pb-2 text-[13px] text-muted-foreground">{back}</div> : null}
        <div
          className={`flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-4 ${
            tabs?.length ? "pb-3 md:pb-4" : "pb-4 md:pb-5"
          }`}
        >
          <div className="min-w-0">
            <h1 className="truncate font-display text-3xl leading-tight md:text-4xl">{title}</h1>
            {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
            {meta ? <div className="mt-3">{meta}</div> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {action}
            {actions}
            {bell ? (
              <span className="hidden md:inline-flex">
                <NotificationBell />
              </span>
            ) : null}
          </div>
        </div>
        {tabs?.length ? (
          <div role="tablist" className="-mb-px flex gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.active}
                onClick={t.onSelect}
                className={`h-10 whitespace-nowrap border-b-2 px-3.5 text-sm transition-colors ${
                  t.active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
