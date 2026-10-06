/**
 * Hosted MCP tool → required OAuth scopes + truthful annotations.
 * Hide from tools/list ≠ access control: assertToolAllowed enforces scopes on call.
 */
import { TOOL_CATALOG } from "./tool-catalog";

export const HOSTED_SCOPES = [
  "planner:read",
  "planner:write",
  "account:read",
  "account:write",
  "github:read",
  "github:write",
  "github:merge",
] as const;

export type HostedScope = (typeof HOSTED_SCOPES)[number];

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ToolPolicy = {
  /** Empty = any valid hosted token (agent_guide). */
  scopes: readonly HostedScope[];
  annotations: ToolAnnotations;
};

const R = "planner:read" as const;
const W = "planner:write" as const;
const AR = "account:read" as const;
const AW = "account:write" as const;
const GR = "github:read" as const;
const GW = "github:write" as const;
const GM = "github:merge" as const;

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const writeLocal = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const githubRead = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const githubWrite = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
const githubMerge = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

/** Explicit matrix: every catalog tool must appear here (enforced by tests). */
export const HOSTED_TOOL_POLICY: Record<string, ToolPolicy> = {
  agent_guide: { scopes: [], annotations: { ...readOnly, openWorldHint: false } },

  list_plans: { scopes: [R], annotations: readOnly },
  get_plan: { scopes: [R], annotations: readOnly },
  list_available_tasks: { scopes: [R], annotations: readOnly },
  get_task: { scopes: [R], annotations: readOnly },
  list_people: { scopes: [R], annotations: readOnly },
  list_task_attachments: { scopes: [R], annotations: readOnly },
  view_task_attachment: { scopes: [R], annotations: readOnly },
  list_plan_attachments: { scopes: [R], annotations: readOnly },
  view_plan_attachment: { scopes: [R], annotations: readOnly },
  read_attachment_text: { scopes: [R], annotations: readOnly },
  list_questions: { scopes: [R], annotations: readOnly },

  claim_task: { scopes: [R, W], annotations: writeLocal },
  start_task: { scopes: [R, W], annotations: writeLocal },
  report_progress: { scopes: [R, W], annotations: writeLocal },
  complete_task: { scopes: [R, W], annotations: writeLocal },
  block_task: { scopes: [R, W], annotations: writeLocal },
  unclaim_task: { scopes: [R, W], annotations: writeLocal },
  add_task_comment: { scopes: [R, W], annotations: writeLocal },
  ask_question: { scopes: [R, W], annotations: writeLocal },
  answer_question: { scopes: [R, W], annotations: writeLocal },
  dismiss_question: { scopes: [R, W], annotations: writeLocal },
  add_task_features: { scopes: [R, W], annotations: writeLocal },
  update_task_feature: { scopes: [R, W], annotations: writeLocal },
  add_task_step: { scopes: [R, W], annotations: writeLocal },
  add_task_steps: { scopes: [R, W], annotations: writeLocal },
  update_task_step: { scopes: [R, W], annotations: writeLocal },
  create_plan: { scopes: [R, W], annotations: writeLocal },
  import_plan_markdown: { scopes: [R, W], annotations: writeLocal },
  upload_attachment_text: { scopes: [R, W], annotations: writeLocal },
  upload_attachment_base64: { scopes: [R, W], annotations: writeLocal },
  set_plan_status: { scopes: [R, W], annotations: writeLocal },
  create_section: { scopes: [R, W], annotations: writeLocal },
  update_section: { scopes: [R, W], annotations: writeLocal },
  create_task: { scopes: [R, W], annotations: writeLocal },
  update_task: { scopes: [R, W], annotations: writeLocal },

  github_status: { scopes: [R, GR], annotations: githubRead },
  check_pr_status: { scopes: [R, GR], annotations: githubRead },
  list_plan_pull_requests: { scopes: [R, GR], annotations: githubRead },
  create_pull_request: { scopes: [R, W, GR, GW], annotations: githubWrite },
  // Actual merge checked at call-time via dry_run in http-handler / register-tools callers.
  merge_plan_pull_requests: { scopes: [R, GR], annotations: githubMerge },

  get_workspace: { scopes: [AR], annotations: readOnly },
  list_projects: { scopes: [AR], annotations: readOnly },
  get_project: { scopes: [AR], annotations: readOnly },
  list_tickets: { scopes: [AR], annotations: readOnly },
  get_ticket: { scopes: [AR], annotations: readOnly },
  update_project: { scopes: [AR, AW], annotations: writeLocal },
  create_ticket: { scopes: [AR, AW], annotations: writeLocal },
  update_ticket: { scopes: [AR, AW], annotations: writeLocal },
  create_task_from_ticket: { scopes: [AR, AW, R, W], annotations: writeLocal },
};

export function policyForTool(toolName: string): ToolPolicy | undefined {
  return HOSTED_TOOL_POLICY[toolName];
}

export function unmappedCatalogTools(
  catalog: readonly { name: string }[] = TOOL_CATALOG,
): string[] {
  return catalog.map((t) => t.name).filter((name) => !HOSTED_TOOL_POLICY[name]);
}

export function scopesSatisfied(granted: readonly string[], required: readonly string[]): boolean {
  return required.every((s) => granted.includes(s));
}

/**
 * Scopes required for a tools/call. merge_plan_pull_requests expands when not dry-run.
 */
export function requiredScopesForCall(
  toolName: string,
  args?: Record<string, unknown> | null,
): readonly HostedScope[] {
  if (toolName === "merge_plan_pull_requests") {
    const dryRun = args?.dry_run !== false; // default dry-run
    if (dryRun) return [R, GR];
    return [R, W, GR, GM];
  }
  const policy = HOSTED_TOOL_POLICY[toolName];
  return policy?.scopes ?? [];
}

export class InsufficientScopeError extends Error {
  readonly requiredScopes: readonly string[];
  constructor(toolName: string, requiredScopes: readonly string[]) {
    super(`insufficient_scope for ${toolName}: requires ${requiredScopes.join(" ")}`);
    this.name = "InsufficientScopeError";
    this.requiredScopes = requiredScopes;
  }
}

export function assertHostedToolAllowed(
  toolName: string,
  grantedScopes: readonly string[],
  args?: Record<string, unknown> | null,
): void {
  if (!HOSTED_TOOL_POLICY[toolName]) {
    throw new InsufficientScopeError(toolName, ["(unmapped tool)"]);
  }
  const required = requiredScopesForCall(toolName, args);
  if (required.length === 0) return;
  if (!scopesSatisfied(grantedScopes, required)) {
    throw new InsufficientScopeError(toolName, required);
  }
}
