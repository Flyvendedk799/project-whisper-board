import { describe, expect, it } from "vitest";
import {
  hostedMcpSnippets,
  MCP_SERVER_NAME,
  mcpSnippets,
  plannerApiUrl,
  REPO_PATH_PLACEHOLDER,
  shellQuote,
} from "./connect-snippets";

describe("plannerApiUrl", () => {
  it("adds the planner path to wherever Boared runs", () => {
    expect(plannerApiUrl("https://boared.online")).toBe("https://boared.online/api/planner");
    expect(plannerApiUrl("http://localhost:3000/")).toBe("http://localhost:3000/api/planner");
  });
});

describe("shellQuote", () => {
  it("leaves plain paths alone and quotes the rest", () => {
    expect(shellQuote("/home/me/boared")).toBe("/home/me/boared");
    expect(shellQuote("C:/Users/me/My Boared")).toBe("'C:/Users/me/My Boared'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("mcpSnippets", () => {
  const snippets = mcpSnippets({ origin: "https://boared.example", repoPath: "/srv/boared/" });

  it("points every client at this instance and the local checkout", () => {
    expect(snippets.apiUrl).toBe("https://boared.example/api/planner");
    for (const text of [snippets.claudeCode, snippets.antigravity, snippets.cursor]) {
      expect(text).toContain("/srv/boared/src/mcp/server.ts");
    }
    expect(snippets.claudeCode).toContain("PLANNER_API_URL=https://boared.example/api/planner");
    expect(snippets.claudeCode.startsWith(`claude mcp add --scope user ${MCP_SERVER_NAME}`)).toBe(
      true,
    );
    expect(snippets.antigravity).toBe(
      `agy mcp add ${MCP_SERVER_NAME} npx --prefix /srv/boared tsx /srv/boared/src/mcp/server.ts`,
    );
    expect(snippets.env).toBe(
      "PLANNER_API_KEY=cpk_...\nPLANNER_API_URL=https://boared.example/api/planner\n",
    );
    expect(snippets.curl).toContain("https://boared.example/api/planner/plans");
  });

  it("writes Cursor config as valid JSON with the key and URL in env", () => {
    const config = JSON.parse(snippets.cursor);
    const server = config.mcpServers[MCP_SERVER_NAME];
    expect(server.command).toBe("npx");
    expect(server.args).toEqual([
      "--prefix",
      "/srv/boared",
      "tsx",
      "/srv/boared/src/mcp/server.ts",
    ]);
    expect(server.env).toEqual({
      PLANNER_API_KEY: "cpk_...",
      PLANNER_API_URL: "https://boared.example/api/planner",
    });
  });

  it("keeps a placeholder until a path is typed, and quotes a path with spaces", () => {
    expect(mcpSnippets({ origin: "https://x.test" }).antigravity).toContain(REPO_PATH_PLACEHOLDER);
    expect(mcpSnippets({ origin: "https://x.test", repoPath: "  " }).cursor).toContain(
      REPO_PATH_PLACEHOLDER,
    );
    const spaced = mcpSnippets({ origin: "https://x.test", repoPath: "/my files/boared" });
    expect(spaced.claudeCode).toContain("--prefix '/my files/boared'");
  });
});

describe("hostedMcpSnippets", () => {
  it("points at Streamable HTTP without embedding secrets", () => {
    const hosted = hostedMcpSnippets("https://boared.online");
    expect(hosted.mcpUrl).toBe("https://boared.online/api/mcp");
    expect(hosted.cursor).toContain("https://boared.online/api/mcp");
    expect(hosted.cursor.toLowerCase()).not.toContain("secret");
    expect(hosted.cursor).not.toContain("cpk_");
    expect(hosted.claudeCode).toContain("--transport http");
    expect(hosted.note.toLowerCase()).toContain("oauth");
  });
});
