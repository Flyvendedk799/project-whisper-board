export const API_SCOPE_PLANNER = "planner";
export const API_SCOPE_ACCOUNT = "account";

export const API_SCOPES = [API_SCOPE_PLANNER, API_SCOPE_ACCOUNT] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** Planner routes stay available to planner keys and to full-account keys. */
export function allowsPlanner(scopes: readonly string[]): boolean {
  return scopes.includes(API_SCOPE_PLANNER) || scopes.includes(API_SCOPE_ACCOUNT);
}

/** Projects, tickets, and the rest of the workspace need the account scope. */
export function allowsAccount(scopes: readonly string[]): boolean {
  return scopes.includes(API_SCOPE_ACCOUNT);
}

export function normalizeScopes(scopes: readonly string[]): ApiScope[] {
  const picked = API_SCOPES.filter((scope) => scopes.includes(scope));
  return picked.length > 0 ? [...picked] : [API_SCOPE_PLANNER];
}
