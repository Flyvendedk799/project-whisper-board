/**
 * Stdio-only MCP client helpers: dotenv, PLANNER_API_KEY, HTTP to /api/planner
 * and /api/v1, and local file reads for upload_attachment_base64.
 * Hosted HTTP must not import this module.
 */
import dotenv from "dotenv";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { accountApiUrl } from "./api-url";
import type { AccountApiPort, LocalUploadReader, PlannerApiPort, PlannerToolPorts } from "./ports";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Load CWD → Boared project root → ~/.boared.env (stdio entry only). */
export function loadStdioEnv(): void {
  dotenv.config();
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
  dotenv.config({ path: path.join(os.homedir(), ".boared.env") });
}

export function plannerApiBaseUrl(): string {
  return (
    process.env.PLANNER_API_URL ||
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3000/api/planner"
      : "https://boared.online/api/planner")
  );
}

export function getPlannerApiKey(): string {
  let key = process.env.PLANNER_API_KEY;
  if (!key) {
    loadStdioEnv();
    key = process.env.PLANNER_API_KEY;
  }
  if (!key) {
    throw new Error(
      "Missing PLANNER_API_KEY. Create an API key in Boared (Settings -> API keys, or Plan options -> Planner API keys) and set PLANNER_API_KEY in your .env or ~/.boared.env",
    );
  }
  return key;
}

async function request(
  baseUrl: string,
  requestPath: string,
  options: RequestInit = {},
): Promise<unknown> {
  const apiKey = getPlannerApiKey();
  const url = `${baseUrl}/${requestPath.replace(/^\//, "")}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API Error (${response.status}): ${text}`);
  }

  return response.json();
}

export function createStdioPlannerPort(apiUrl: string = plannerApiBaseUrl()): PlannerApiPort {
  return {
    get: (p) => request(apiUrl, p),
    post: (p, body) =>
      request(apiUrl, p, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
  };
}

export function createStdioAccountPort(apiUrl: string = plannerApiBaseUrl()): AccountApiPort {
  const accountUrl = accountApiUrl(apiUrl);
  return {
    get: (p) => request(accountUrl, p),
    request: (p, init) => request(accountUrl, p, init),
  };
}

/** The API's own limit; checked here so a large file is not read into memory for nothing. */
export const MAX_UPLOAD_FILE_BYTES = 8 * 1024 * 1024;

export const readLocalUpload: LocalUploadReader = async (filePath) => {
  const resolved = path.resolve(filePath);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`${resolved} is not a file.`);
  if (info.size > MAX_UPLOAD_FILE_BYTES) {
    throw new Error(`${resolved} is over the 8 MiB upload limit.`);
  }
  const dataBase64 = (await readFile(resolved)).toString("base64");
  return { dataBase64, fileName: path.basename(resolved), sizeBytes: info.size };
};

/**
 * Stdio tool ports with instance-local claim memory (not a module global shared
 * across HTTP callers).
 */
export function createStdioToolPorts(apiUrl: string = plannerApiBaseUrl()): PlannerToolPorts {
  let sessionAgentId: string | undefined;
  return {
    mode: "stdio",
    planner: createStdioPlannerPort(apiUrl),
    account: createStdioAccountPort(apiUrl),
    resolveAgent: (agentId) => agentId ?? sessionAgentId,
    rememberClaim: (agentId) => {
      sessionAgentId = agentId;
    },
    readLocalUpload,
  };
}
