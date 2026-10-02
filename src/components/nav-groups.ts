import { queueSearch } from "@/features/triage/queue-views";

export interface NavItem {
  to: string;
  label: string;
  badge?: number;
  /** Search params for the link, used by Triage to land on "All open". */
  search?: Record<string, unknown>;
  /** Extra path prefixes that keep this item highlighted (ticket detail → Triage). */
  alsoActiveFor?: string[];
  exact?: boolean;
}

/**
 * Grouped navigation: work, business, then inbox and settings. The groups and
 * which items exist are decided by the signed-in user's real role — there is no
 * way to switch into the other view, only to be in the one you have.
 */
export function buildNavGroups({
  isAdmin,
  needsTriage,
  unread,
}: {
  isAdmin: boolean;
  needsTriage: number;
  unread: number;
}): NavItem[][] {
  const inbox: NavItem = { to: "/app/inbox", label: "Inbox", badge: unread };
  const settings: NavItem = { to: "/app/settings", label: "Settings" };

  if (!isAdmin) {
    return [
      [
        { to: "/app", label: "Home", exact: true },
        {
          to: "/app/tickets",
          label: "My tickets",
          alsoActiveFor: ["/app/tickets/", "/app/report"],
        },
        { to: "/app/projects", label: "Projects" },
      ],
      [inbox, settings],
    ];
  }

  return [
    [
      { to: "/app", label: "Home", exact: true },
      {
        to: "/app/triage",
        label: "Triage",
        badge: needsTriage,
        search: queueSearch("allOpen"),
        alsoActiveFor: ["/app/tickets", "/app/report"],
      },
      { to: "/app/projects", label: "Projects" },
      { to: "/app/planner", label: "AI Planner" },
      { to: "/app/agents", label: "Agents & MCP" },
    ],
    [
      { to: "/app/organizations", label: "Clients" },
      { to: "/app/time", label: "Time" },
      { to: "/app/reports", label: "Reports" },
      { to: "/app/team", label: "Team" },
    ],
    [inbox, settings],
  ];
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.to;
  return (
    pathname === item.to ||
    pathname.startsWith(`${item.to}/`) ||
    (item.alsoActiveFor ?? []).some((prefix) => pathname.startsWith(prefix))
  );
}
