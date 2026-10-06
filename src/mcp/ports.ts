/**
 * Ports the MCP tool layer talks to. Stdio fills these with HTTP+API-key helpers;
 * hosted HTTP fills them with in-process adapters bound to an IntegrationPrincipal.
 * No dotenv, process.exit, or network listen lives here.
 */

export type McpTransportMode = "stdio" | "http";

/** Planner REST surface (`/api/planner/...`), relative paths without a leading slash. */
export type PlannerApiPort = {
  get: (path: string) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
};

/** Workspace REST surface (`/api/v1/...`). */
export type AccountApiPort = {
  get: (path: string) => Promise<unknown>;
  request: (path: string, init?: RequestInit) => Promise<unknown>;
};

/** Optional local filesystem read for stdio `upload_attachment_base64` file_path. */
export type LocalUploadReader = (filePath: string) => Promise<{
  dataBase64: string;
  fileName: string;
  sizeBytes: number;
}>;

/**
 * Hosted tool-policy hook (codey2). Called before each tools/call.
 * Throw or return a rejected promise to refuse the tool.
 */
export type ToolPolicyHook = (toolName: string) => void | Promise<void>;

export type PlannerToolPorts = {
  mode: McpTransportMode;
  planner: PlannerApiPort;
  account: AccountApiPort;
  /**
   * Resolve the agent id for attribution. Stdio may fall back to the session claim;
   * HTTP is request/task-bound and must not share a module-global session id.
   */
  resolveAgent: (agentId?: string) => string | undefined;
  /**
   * Remember a claim for later tools. Stdio keeps an instance-local id;
   * HTTP should no-op (multi-caller safe).
   */
  rememberClaim: (agentId: string) => void;
  /** Present only for stdio. Hosted must omit and reject file_path uploads. */
  readLocalUpload?: LocalUploadReader;
  /** Optional hosted scope/policy gate. */
  assertToolAllowed?: ToolPolicyHook;
};
