/**
 * Where the workspace API (`/api/v1`: projects and tickets) lives, given where the planner API
 * (`/api/planner`) lives. One `PLANNER_API_URL` configures both, so a setup that already works
 * for the planner reaches tickets as soon as its key has the account scope.
 */
export function accountApiUrl(plannerApiUrl: string): string {
  const base = plannerApiUrl.trim().replace(/\/+$/, "");
  if (!base.endsWith("/api/planner")) {
    throw new Error(
      `PLANNER_API_URL must end in /api/planner to reach the workspace API (got "${plannerApiUrl}").`,
    );
  }
  return `${base.slice(0, -"/planner".length)}/v1`;
}
