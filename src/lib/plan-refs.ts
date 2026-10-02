/**
 * Plan tasks can hold soft links to tickets and PRs. When those targets are
 * gone (or were never real), the UI must not keep implying they exist.
 */

export type PlanRefTask = {
  ticket_id?: string | null;
  ticket?: { id: string } | null;
  pr_number?: number | null;
  pr_url?: string | null;
  pr_status?: string | null;
};

/** ticket_id set but the join found nothing — deleted, hidden, or never real. */
export function isOrphanTicketRef(task: PlanRefTask): boolean {
  return Boolean(task.ticket_id) && !task.ticket;
}

/** A PR badge/link is only honest when we have a URL (and usually a number). */
export function hasLivePullRequest(task: PlanRefTask): boolean {
  return Boolean(task.pr_url?.trim());
}

/** PR number without a URL — looks linked on the card, empty in the drawer. */
export function isOrphanPullRequestRef(task: PlanRefTask): boolean {
  return Boolean(task.pr_number) && !hasLivePullRequest(task);
}

/**
 * Strip free-text ticket/PR citations so comments and descriptions cannot keep
 * selling links that the structured fields no longer have.
 */
export function scrubStalePlanRefs(body: string): string {
  return body
    .replace(/\bresolves\s+ticket(?:\s*#\d+)?\b[^.!\n]*[.!]?/gi, "")
    .replace(/\b(?:from\s+)?ticket\s*#\d+\b[^.!\n]*[.!]?/gi, "")
    .replace(/\bPR\s*#\d+\b/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Scrub citations unless the task still has a live ticket or PR link. */
export function scrubCommentIfUnlinked(body: string, task: PlanRefTask): string {
  if (task.ticket?.id || hasLivePullRequest(task)) return body;
  return scrubStalePlanRefs(body);
}

/**
 * `https://github.com/owner/repo/pull/123` -> `{ repo: "owner/repo", number: 123 }`.
 * Anything else (an issue, a compare view, a non-GitHub host) is not a pull request.
 */
export function parsePullRequestUrl(
  url: string | null | undefined,
): { repo: string; number: number } | null {
  const match = url
    ?.trim()
    .match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i);
  if (!match) return null;
  return { repo: match[1], number: Number(match[2]) };
}
