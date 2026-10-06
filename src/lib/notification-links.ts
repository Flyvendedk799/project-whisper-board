/**
 * Where a notification's `link` opens. Links are stored as plain paths (the
 * same ones the emails use), so the inbox turns them back into typed routes,
 * keeping the query: a planner link carries the task to open.
 */
export type NotificationLinkTarget =
  | { kind: "ticket"; ticketId: string }
  | { kind: "project"; projectId: string; tab?: string }
  | { kind: "plan"; planId: string; task?: string }
  | { kind: "app"; path: string }
  | null;

export function notificationLinkTarget(link: string | null | undefined): NotificationLinkTarget {
  if (!link || !link.startsWith("/app")) return null;
  let url: URL;
  try {
    url = new URL(link, "https://boared.invalid");
  } catch {
    return null;
  }
  const segment = (prefix: string) => {
    const match = new RegExp(`^/app/${prefix}/([^/]+)$`).exec(url.pathname);
    return match ? decodeURIComponent(match[1]!) : null;
  };
  const param = (name: string) => url.searchParams.get(name) || undefined;

  const ticketId = segment("tickets");
  if (ticketId) return { kind: "ticket", ticketId };
  const projectId = segment("projects");
  if (projectId) return { kind: "project", projectId, tab: param("tab") };
  const planId = segment("planner");
  if (planId) return { kind: "plan", planId, task: param("task") };
  return { kind: "app", path: url.pathname };
}
