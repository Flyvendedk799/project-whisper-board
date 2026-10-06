/**
 * Principal-bound MCP adapters that call extracted planner/account handlers
 * in-process — no Authorization header, no loopback HTTP.
 */
import type { IntegrationPrincipal } from "@/lib/integration-principal";
import { handleAccountRequest } from "@/lib/account-api";
import { handlePlannerRequest } from "@/lib/planner-api";
import type { AccountApiPort, PlannerApiPort, PlannerToolPorts } from "./ports";

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API Error (${response.status}): ${text || response.statusText}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function plannerRequest(method: "GET" | "POST", path: string, body?: unknown): Request {
  const url = `https://boared.local/api/planner/${path.replace(/^\//, "")}`;
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function accountRequest(method: string, path: string, init?: RequestInit): Request {
  const url = `https://boared.local/api/v1/${path.replace(/^\//, "")}`;
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Request(url, { ...init, method, headers });
}

export function createInProcessPlannerPort(principal: IntegrationPrincipal): PlannerApiPort {
  return {
    get: async (path) =>
      readJsonResponse(await handlePlannerRequest(plannerRequest("GET", path), principal, path)),
    post: async (path, body) =>
      readJsonResponse(
        await handlePlannerRequest(plannerRequest("POST", path, body), principal, path),
      ),
  };
}

export function createInProcessAccountPort(principal: IntegrationPrincipal): AccountApiPort {
  return {
    get: async (path) =>
      readJsonResponse(await handleAccountRequest(accountRequest("GET", path), principal, path)),
    request: async (path, init) =>
      readJsonResponse(
        await handleAccountRequest(
          accountRequest(init?.method ?? "GET", path, init),
          principal,
          path,
        ),
      ),
  };
}

/**
 * Hosted HTTP tool ports. Claim memory is a no-op (multi-caller safe);
 * resolveAgent only returns an explicit agent_id. No local file uploads.
 */
export function createInProcessPorts(principal: IntegrationPrincipal): PlannerToolPorts {
  return {
    mode: "http",
    planner: createInProcessPlannerPort(principal),
    account: createInProcessAccountPort(principal),
    resolveAgent: (agentId) => agentId,
    rememberClaim: () => {
      /* HTTP: no shared sessionAgentId across callers */
    },
    // readLocalUpload omitted — file_path rejected in register-tools
  };
}
