import { describe, expect, it } from "vitest";
import { accountApiUrl } from "./api-url";

describe("accountApiUrl", () => {
  it("swaps the planner path for the workspace path on the same origin", () => {
    expect(accountApiUrl("https://boared.online/api/planner")).toBe("https://boared.online/api/v1");
    expect(accountApiUrl("http://localhost:3000/api/planner/")).toBe(
      "http://localhost:3000/api/v1",
    );
  });

  it("keeps a path prefix in front of /api", () => {
    expect(accountApiUrl("https://example.com/boared/api/planner")).toBe(
      "https://example.com/boared/api/v1",
    );
  });

  it("says what is wrong when the URL is not a planner URL", () => {
    expect(() => accountApiUrl("https://boared.online")).toThrow(/PLANNER_API_URL/);
  });
});
