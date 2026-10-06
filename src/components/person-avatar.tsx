/* eslint-disable react-refresh/only-export-components -- the helpers are the avatar's own rules, kept beside it. */
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The one face for a person, everywhere a person appears: member lists,
 * assignee pickers and chips, comments, the activity feed, the inbox.
 *
 * A photo when there is one (uploaded, or from the sign-in provider), and
 * initials otherwise — including when the photo URL is broken, which provider
 * photos eventually are. A pending invite gets a dashed ring so it reads as
 * "not here yet" before anyone reads the label.
 */

export interface AvatarPerson {
  id?: string | null;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: "h-[18px] w-[18px] text-[8px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-10 w-10 text-xs",
  xl: "h-16 w-16 text-lg",
};

/** Warm, readable tints from the chart palette, picked by id so a person keeps theirs. */
const TINTS = [
  "bg-chart-1/20",
  "bg-chart-2/20",
  "bg-chart-3/20",
  "bg-chart-4/25",
  "bg-chart-5/20",
  "bg-accent",
];

/** Up to two letters from a name, or the start of an email; "?" for nobody. */
export function personInitials(person: AvatarPerson | null | undefined): string {
  const name = person?.full_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const letters =
      parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : parts[0]!.slice(0, 1);
    return letters.toUpperCase();
  }
  const email = person?.email?.trim();
  if (email) return email.slice(0, 1).toUpperCase();
  return "?";
}

/** What to call someone in a list or a chip. */
export function personName(person: AvatarPerson | null | undefined, fallback = "Someone"): string {
  return person?.full_name?.trim() || person?.email?.trim() || fallback;
}

/** Only web images: an `avatar_url` is user-supplied, so anything else is ignored. */
export function safeAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  return /^https?:\/\/[^\s]+$/i.test(trimmed) ? trimmed : null;
}

export function tintFor(key: string | null | undefined): string {
  if (!key) return "bg-muted";
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length]!;
}

export function PersonAvatar({
  person,
  size = "md",
  pending = false,
  className,
  label,
}: {
  person: AvatarPerson | null | undefined;
  size?: AvatarSize;
  /** Invited but never signed in. */
  pending?: boolean;
  className?: string;
  /**
   * Accessible name. Omit when the name is printed next to the avatar (the
   * usual case): the avatar is then decorative and hidden from screen readers.
   */
  label?: string;
}) {
  const src = safeAvatarUrl(person?.avatar_url);
  // Remember which URL failed, so a new photo gets its own chance to load.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      data-pending={pending || undefined}
      className={cn(
        "relative inline-grid shrink-0 select-none place-items-center overflow-hidden rounded-full font-semibold leading-none text-foreground",
        SIZE_CLASS[size],
        !showImage &&
          (pending ? "bg-muted text-muted-foreground" : tintFor(person?.id ?? person?.email)),
        pending && "outline-dashed outline-1 outline-offset-1 outline-muted-foreground/60",
        className,
      )}
    >
      {showImage ? (
        <img
          src={src!}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-cover"
        />
      ) : (
        personInitials(person)
      )}
    </span>
  );
}

/** Avatar and name together: assignee chips, reporters, mentions in lists. */
export function PersonChip({
  person,
  size = "sm",
  pending = false,
  className,
  suffix,
  fallback = "Unassigned",
}: {
  person: AvatarPerson | null | undefined;
  size?: AvatarSize;
  pending?: boolean;
  className?: string;
  suffix?: React.ReactNode;
  fallback?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <PersonAvatar person={person} size={size} pending={pending} />
      <span className={cn("truncate", !person && "text-muted-foreground")}>
        {person ? personName(person) : fallback}
      </span>
      {pending ? (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
          Pending
        </span>
      ) : null}
      {suffix}
    </span>
  );
}

/** A few overlapping faces, e.g. the members of a project. */
export function AvatarStack({
  people,
  max = 4,
  size = "sm",
  className,
}: {
  people: ReadonlyArray<AvatarPerson & { pending?: boolean }>;
  max?: number;
  size?: AvatarSize;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span
      className={cn("flex items-center -space-x-1.5", className)}
      aria-label={people.map((person) => personName(person)).join(", ")}
      role="img"
    >
      {shown.map((person, index) => (
        <PersonAvatar
          key={person.id ?? person.email ?? index}
          person={person}
          size={size}
          pending={person.pending}
          className="ring-2 ring-background"
        />
      ))}
      {rest > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            "inline-grid shrink-0 place-items-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-background",
            SIZE_CLASS[size],
          )}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
