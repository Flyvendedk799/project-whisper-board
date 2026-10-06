/**
 * Default for plans.clients_can_view on create.
 * Workspace admins create agency-only plans (false); clients / client_admins
 * create plans visible to project members (true). Admins can still toggle in settings.
 */
export function clientsCanViewDefaultForRole(role: string | null | undefined): boolean {
  return role !== "admin";
}
