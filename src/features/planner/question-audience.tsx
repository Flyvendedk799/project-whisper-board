import { cn } from "@/lib/utils";

import {
  AUDIENCES,
  AUDIENCE_HINT,
  AUDIENCE_LABEL,
  audienceOf,
  type Audience,
} from "./audience-model";

const AUDIENCE_CLASS: Record<Audience, string> = {
  agency: "bg-muted text-muted-foreground",
  agent: "bg-primary/10 text-primary",
  client: "bg-info/15 text-info",
};

export function AudienceBadge({
  question,
}: {
  question: { audience?: string | null; from_client?: boolean | null };
}) {
  const audience = audienceOf(question);
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px] font-medium max-md:text-xs",
          AUDIENCE_CLASS[audience],
        )}
        title={AUDIENCE_HINT[audience]}
      >
        {AUDIENCE_LABEL[audience]}
      </span>
      {question.from_client ? (
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success max-md:text-xs">
          From the client
        </span>
      ) : null}
    </span>
  );
}

/** Pick who a new question is for. */
export function AudiencePicker({
  value,
  onChange,
}: {
  value: Audience;
  onChange: (next: Audience) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Who should answer" className="flex flex-wrap gap-1.5">
      {AUDIENCES.map((audience) => (
        <button
          key={audience}
          type="button"
          role="radio"
          aria-checked={value === audience}
          title={AUDIENCE_HINT[audience]}
          onClick={() => onChange(audience)}
          className={cn(
            "h-8 rounded-full border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10 max-md:text-[13px]",
            value === audience
              ? "border-primary bg-accent font-medium"
              : "bg-card hover:bg-muted/60",
          )}
        >
          {AUDIENCE_LABEL[audience]}
        </button>
      ))}
    </div>
  );
}
