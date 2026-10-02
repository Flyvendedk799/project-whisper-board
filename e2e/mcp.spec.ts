import { expect, test } from "@playwright/test";

/**
 * The public MCP and skill page needs no account, so this is the one agent-facing screen a
 * credential-free run can really exercise: it boots, switches tabs, hands over the skill, and
 * leaves the signed-in dashboard page where it was.
 */

test("the MCP and skill page opens without signing in", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/mcp");
  await page.waitForLoadState("networkidle");

  await expect(page).toHaveTitle(/MCP server and skill/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI agent");
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
  await expect(page.getByText(/git clone https:\/\/github\.com\//)).toBeVisible();
  expect(errors).toEqual([]);
});

test("the tabs show the tools, the skill and the workflow, and keep the tab in the URL", async ({
  page,
}) => {
  await page.goto("/mcp");
  await page.waitForLoadState("networkidle");

  await page.getByRole("tab", { name: "Tools" }).click();
  await expect(page).toHaveURL(/tab=tools/);
  await expect(page.getByLabel("Search tools")).toBeVisible();
  await expect(page.locator('[data-tool="list_tickets"]')).toBeVisible();

  await page.getByRole("tab", { name: "Skill" }).click();
  await expect(page.getByLabel("SKILL.md")).toContainText("name: ai-planner");

  await page.goto("/mcp?tab=workflow");
  await expect(page.getByText("Claim a task before working on it")).toBeVisible();
});

test("the skill downloads as SKILL.md", async ({ page }) => {
  await page.goto("/mcp");
  await page.waitForLoadState("networkidle");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Download the skill/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("SKILL.md");
});

test("the landing page links to it, and the dashboard page still asks for a sign-in", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "For agents" }).click();
  await expect(page).toHaveURL(/\/mcp/);

  await page.goto("/app/agents");
  await expect(page).toHaveURL(/\/login/);
});
