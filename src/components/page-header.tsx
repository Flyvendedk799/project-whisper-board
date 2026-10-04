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
    // Desktop: one sticky bar. Phone: the wrapper boxes dissolve (`contents`), the
    // title scrolls away with the page to give the content the screen, and only
    // the tab row stays pinned, directly under the top bar.
    <div className="max-md:contents md:sticky md:top-0 md:z-20 md:border-b md:bg-background/90 md:backdrop-blur">
      <div className={`mx-auto px-4 pt-4 md:px-8 md:pt-6 max-md:contents ${maxWidth}`}>
        {back ? (
          <div className="pb-2 text-[13px] text-muted-foreground max-md:px-4 max-md:pt-3">
            {back}
          </div>
        ) : null}
        <div
          className={`flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-4 max-md:px-4 ${
            back ? "" : "max-md:pt-3"
          } ${tabs?.length ? "pb-3 md:pb-4" : "pb-4 md:pb-5 max-md:border-b"}`}
        >
          <div className="min-w-0">
            <h1 className="truncate font-display text-3xl leading-tight md:text-4xl max-md:text-[28px]">
              {title}
            </h1>
            {description && (
              <div className="mt-1 text-sm text-muted-foreground max-md:line-clamp-2">
                {description}
              </div>
            )}
            {meta ? <div className="mt-3">{meta}</div> : null}
          </div>
          <div
            className={`flex flex-wrap items-center gap-2 ${action || actions ? "" : "max-md:hidden"}`}
          >
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
          <div
            role="tablist"
            className="no-scrollbar -mb-px flex gap-1 overflow-x-auto max-md:sticky max-md:top-[var(--mobile-topbar-h)] max-md:z-20 max-md:mb-0 max-md:border-b max-md:bg-background/95 max-md:px-2 max-md:backdrop-blur"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.active}
                onClick={t.onSelect}
                className={`h-10 whitespace-nowrap border-b-2 px-3.5 text-sm transition-colors max-md:h-12 max-md:shrink-0 ${
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
