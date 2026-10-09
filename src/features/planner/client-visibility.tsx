import { Eye, EyeOff } from "lucide-react";
import { clientVisibilityOf, type ClientVisibility } from "@/lib/plan-visibility";
import { cn } from "@/lib/utils";

const COPY: Record<ClientVisibility, { label: string; title: string; className: string }> = {
  visible: {
    label: "Client can see",
    title: "Clients on this project can open this plan",
    className: "bg-success/15 text-success",
  },
  no_project: {
    label: "Not shared",
    title: "Shared with clients, but the plan has no project, so nobody can see it yet",
    className: "bg-warning/15 text-warning",
  },
  internal: {
    label: "Internal",
    title: "Clients can't see this plan",
    className: "bg-muted text-muted-foreground",
  },
};

export function ClientVisibilityBadge({
  plan,
  onClick,
  className,
}: {
  plan: { clients_can_view?: boolean | null; project_id?: string | null };
  /** Makes the badge a button, for the plan header where the setting can be changed. */
  onClick?: () => void;
  className?: string;
}) {
  const state = clientVisibilityOf(plan);
  const { label, title, className: tone } = COPY[state];
  const Icon = state === "internal" ? EyeOff : Eye;
  const classes = cn(
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
    tone,
    className,
  );
  const content = (
    <>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        title={`${title}. Change in plan settings.`}
        onClick={onClick}
        className={cn(
          classes,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-80 max-md:min-h-9 max-md:px-3",
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <span title={title} className={classes}>
      {content}
    </span>
  );
}
