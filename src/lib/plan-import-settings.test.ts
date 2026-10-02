import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { applyPlanSettings } from "./plan-import";
import type { PlanMdSettings } from "./plan-markdown";

const NONE = {
  id: "p1",
  description: null,
  github_repo: null,
  github_base: null,
  github_work_mode: null,
  github_work_branch: null,
};

/** A client that only knows `plans.update(patch).eq(...)`, and records the patches. */
function fakeClient(error: { message: string } | null = null) {
  const patches: unknown[] = [];
  const client = {
    from: () => ({
      update: (patch: unknown) => {
        patches.push(patch);
        return { eq: async () => ({ error }) };
      },
    }),
  } as unknown as SupabaseClient<Database>;
  return { client, patches };
}

const settings: PlanMdSettings = {
  description: "From the file.",
  status: "completed",
  repo: "acme/app",
  base: "main",
  workMode: "new",
  workBranch: "plan/q4",
};

describe("applyPlanSettings", () => {
  it("fills a plan that has nothing set, in every mode", async () => {
    for (const mode of ["sync", "merge", "replace"] as const) {
      const { client, patches } = fakeClient();
      const updated = await applyPlanSettings(client, NONE, settings, mode);
      expect(updated).toEqual(["description", "repo", "base", "workBranch"]);
      expect(patches).toEqual([
        {
          description: "From the file.",
          github_repo: "acme/app",
          github_base: "main",
          github_work_mode: "new",
          github_work_branch: "plan/q4",
        },
      ]);
    }
  });

  it("never changes the repository, base or branch a plan already has on merge or sync", async () => {
    const plan = {
      ...NONE,
      description: "Mine.",
      github_repo: "acme/app",
      github_base: "develop",
      github_work_mode: "existing",
      github_work_branch: "feature/x",
    };
    for (const mode of ["sync", "merge"] as const) {
      const { client, patches } = fakeClient();
      expect(await applyPlanSettings(client, plan, settings, mode)).toEqual([]);
      expect(patches).toEqual([]);
    }
  });

  it("replace sets the working branch (and description) but not the repository or base", async () => {
    const plan = {
      ...NONE,
      description: "Mine.",
      github_repo: "acme/app",
      github_base: "develop",
      github_work_mode: "existing",
      github_work_branch: "feature/x",
    };
    const { client, patches } = fakeClient();
    expect(await applyPlanSettings(client, plan, settings, "replace")).toEqual([
      "description",
      "workBranch",
    ]);
    expect(patches).toEqual([
      {
        description: "From the file.",
        github_work_mode: "new",
        github_work_branch: "plan/q4",
      },
    ]);
  });

  it("ignores a working branch from a different repository", async () => {
    const { client, patches } = fakeClient();
    const updated = await applyPlanSettings(
      client,
      { ...NONE, github_repo: "other/repo", github_base: "main" },
      { workMode: "new", workBranch: "plan/q4", repo: "acme/app" },
      "replace",
    );
    expect(updated).toEqual([]);
    expect(patches).toEqual([]);
  });

  it("needs a repository, and a branch name that is not the base", async () => {
    const noRepo = fakeClient();
    expect(
      await applyPlanSettings(
        noRepo.client,
        NONE,
        { workMode: "new", workBranch: "plan/q4" },
        "merge",
      ),
    ).toEqual([]);
    const clash = fakeClient();
    expect(
      await applyPlanSettings(
        clash.client,
        NONE,
        { repo: "acme/app", base: "main", workMode: "new", workBranch: "main" },
        "merge",
      ),
    ).toEqual(["repo", "base"]);
  });

  it("works on the base branch without a branch name", async () => {
    const { client, patches } = fakeClient();
    await applyPlanSettings(client, NONE, { repo: "acme/app", workMode: "base" }, "merge");
    expect(patches).toEqual([
      { github_repo: "acme/app", github_work_mode: "base", github_work_branch: null },
    ]);
  });

  it("does nothing without settings, and reports nothing when the write fails", async () => {
    const quiet = fakeClient();
    expect(await applyPlanSettings(quiet.client, NONE, undefined, "replace")).toEqual([]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = fakeClient({ message: "denied" });
    expect(await applyPlanSettings(failing.client, NONE, settings, "replace")).toEqual([]);
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
