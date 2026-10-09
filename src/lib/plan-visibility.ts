/**
 * Default for plans.clients_can_view on create.
 * Workspace admins create agency-only plans (false); clients / client_admins
 * create plans visible to project members (true). Admins can still toggle in settings.
 */
export function clientsCanViewDefaultForRole(role: string | null | undefined): boolean {
  return role !== "admin";
}

/**
 * Whether the project's clients can open a plan, for the agency's eyes.
 *
 * A client sees a plan only when it is switched on for clients *and* belongs to a
 * project they are a member of (see `can_view_plan`), so a plan with the switch on
 * but no project is still hidden. Say so rather than showing a false "visible".
 */
export type ClientVisibility = "visible" | "no_project" | "internal";

export function clientVisibilityOf(plan: {
  clients_can_view?: boolean | null;
  project_id?: string | null;
}): ClientVisibility {
  if (!plan.clients_can_view) return "internal";
  return plan.project_id ? "visible" : "no_project";
}
