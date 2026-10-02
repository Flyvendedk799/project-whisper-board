import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ key: null as null | Record<string, unknown> }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: rows.key, error: rows.key ? null : { message: "none" } }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

import { verifyApiKey } from "./api-auth";

const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});
afterEach(() => {
  process.env.SUPABASE_URL = saved.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  rows.key = null;
});

describe("verifyApiKey", () => {
  it("says who made the key, so GitHub calls made with it act as that person", async () => {
    rows.key = {
      id: "k1",
      workspace_id: "ws-1",
      scopes: ["planner"],
      revoked_at: null,
      created_by: "user-1",
    };
    expect(await verifyApiKey("Bearer cpk_anything")).toEqual({
      keyId: "k1",
      workspaceId: "ws-1",
      scopes: ["planner"],
      userId: "user-1",
    });
  });

  it("has no owner for a key whose creator is gone, rather than guessing one", async () => {
    rows.key = {
      id: "k1",
      workspace_id: "ws-1",
      scopes: ["planner"],
      revoked_at: null,
      created_by: null,
    };
    expect((await verifyApiKey("Bearer cpk_anything"))?.userId).toBeNull();
  });

  it("refuses a revoked key and a missing header", async () => {
    rows.key = {
      id: "k1",
      workspace_id: "ws-1",
      scopes: [],
      revoked_at: "2026-01-01",
      created_by: "user-1",
    };
    expect(await verifyApiKey("Bearer cpk_anything")).toBeNull();
    expect(await verifyApiKey(null)).toBeNull();
  });
});
