import { describe, expect, it } from "vitest";
import { clientsCanViewDefaultForRole } from "./plan-visibility";

describe("clientsCanViewDefaultForRole", () => {
  it("hides admin-created plans from clients by default", () => {
    expect(clientsCanViewDefaultForRole("admin")).toBe(false);
  });

  it("shows client-created plans to project members", () => {
    expect(clientsCanViewDefaultForRole("client")).toBe(true);
    expect(clientsCanViewDefaultForRole("client_admin")).toBe(true);
  });

  it("treats a missing role as non-admin (visible) — callers pass membership.role", () => {
    expect(clientsCanViewDefaultForRole(null)).toBe(true);
    expect(clientsCanViewDefaultForRole(undefined)).toBe(true);
  });
});
