/**
 * The setup snippets on the Connect tab, built from where Boared is running.
 * Pure strings, so what an admin copies is tested rather than eyeballed.
 */

/** The server name clients show; kept from the first release so existing setups keep working. */
export const MCP_SERVER_NAME = "consflow-planner";

/** Where the MCP server's source lives. The repository is public, so cloning needs no account. */
export const REPO_URL = "https://github.com/Flyvendedk799/project-whisper-board";
export const REPO_ZIP_URL = `${REPO_URL}/archive/refs/heads/main.zip`;

export const REPO_PATH_PLACEHOLDER = "<path-to-boared>";
export const API_KEY_PLACEHOLDER = "cpk_...";

export const plannerApiUrl = (origin: string) => `${origin.replace(/\/+$/, "")}/api/planner`;

/** Quotes a value for a POSIX shell only when it needs it. */
export function shellQuote(value: string): string {
  return /^[\w@%+=:,./~<>-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface SnippetOptions {
  /** Where this Boared runs, e.g. `window.location.origin`. */
  origin: string;
  /** Where the Boared repository is checked out on the agent's machine. */
  repoPath?: string;
  apiKey?: string;
}

export interface McpSnippets {
  apiUrl: string;
  /** Fetches the server and its dependencies. */
  install: string;
  env: string;
  claudeCode: string;
  codex: string;
  cursor: string;
  antigravity: string;
  curl: string;
}

export function mcpSnippets({
  origin,
  repoPath,
  apiKey = API_KEY_PLACEHOLDER,
}: SnippetOptions): McpSnippets {
  const apiUrl = plannerApiUrl(origin);
  const root = repoPath?.trim().replace(/\/+$/, "") || REPO_PATH_PLACEHOLDER;
  const entry = `${root}/src/mcp/server.ts`;

  const cursor = {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: "npx",
        args: ["--prefix", root, "tsx", entry],
        env: { PLANNER_API_KEY: apiKey, PLANNER_API_URL: apiUrl },
      },
    },
  };

  return {
    apiUrl,
    install: `git clone ${REPO_URL}.git boared\ncd boared\nnpm install`,
    env: `PLANNER_API_KEY=${apiKey}\nPLANNER_API_URL=${apiUrl}\n`,
    claudeCode: [
      `claude mcp add --scope user ${MCP_SERVER_NAME}`,
      `  --env PLANNER_API_KEY=${shellQuote(apiKey)}`,
      `  --env PLANNER_API_URL=${shellQuote(apiUrl)}`,
      `  -- npx --prefix ${shellQuote(root)} tsx ${shellQuote(entry)}`,
    ].join(" \\\n"),
    codex: [
      `codex mcp add ${MCP_SERVER_NAME}`,
      `  --env PLANNER_API_KEY=${shellQuote(apiKey)}`,
      `  --env PLANNER_API_URL=${shellQuote(apiUrl)}`,
      `  -- npx --prefix ${shellQuote(root)} tsx ${shellQuote(entry)}`,
    ].join(" \\\n"),
    cursor: JSON.stringify(cursor, null, 2),
    antigravity: `agy mcp add ${MCP_SERVER_NAME} npx --prefix ${shellQuote(root)} tsx ${shellQuote(entry)}`,
    curl: `curl -s -H "Authorization: Bearer $PLANNER_API_KEY" ${apiUrl}/plans`,
  };
}
