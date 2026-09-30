import { cn } from "@/lib/utils";

interface Starter {
  title: string;
  hint: string;
  onRun: () => void;
  disabled?: boolean;
}

/** What an empty plan shows: three ways to give it structure. */
export function PlanGettingStarted({
  onAddSection,
  onImportMarkdown,
  onImportTickets,
  hasProject,
  importing = false,
}: {
  onAddSection: () => void;
  onImportMarkdown: () => void;
  onImportTickets: () => void;
  hasProject: boolean;
  importing?: boolean;
}) {
  const starters: Starter[] = [
    {
      title: "Add a section",
      hint: "Name the first phase, such as Backlog or Design",
      onRun: onAddSection,
    },
    {
      title: "Import a Markdown outline",
      hint: "Headings become sections, list items become tasks",
      onRun: onImportMarkdown,
    },
    {
      title: "Add open tickets from the linked project",
      hint: hasProject ? "One task per open ticket" : "Link a project in plan settings first",
      onRun: onImportTickets,
      disabled: !hasProject || importing,
    },
  ];

  return (
    <div className="mx-auto my-16 flex max-w-[680px] flex-col gap-6 px-6">
      <div>
        <h2 className="font-display text-[32px] font-normal leading-tight">
          Start by giving this plan some structure
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          Sections are the phases of the work. Tasks inside them can be picked up by you, teammates,
          or agents connected with an API key. Attach screenshots, recordings and documents to give
          agents context.
        </p>
      </div>
      <ol className="grid gap-2.5">
        {starters.map((starter, index) => (
          <li key={starter.title}>
            <button
              type="button"
              disabled={starter.disabled}
              onClick={starter.onRun}
              className={cn(
                "flex w-full items-center gap-4 rounded-xl border bg-card px-[18px] py-4 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                starter.disabled && "cursor-not-allowed opacity-50 hover:border-border",
              )}
            >
              <span
                aria-hidden="true"
                className="flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-accent font-semibold"
              >
                {index + 1}
              </span>
              <span className="flex-1">
                <span className="block font-medium">{starter.title}</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  {starter.hint}
                </span>
              </span>
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
