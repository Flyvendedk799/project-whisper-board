import { expect, test } from "@playwright/test";

/**
 * These run without credentials on purpose: anything requiring a signed-in
 * session would need a seeded Supabase project, and a smoke test that only
 * runs when someone remembers to set that up is a smoke test that never runs.
 */

test("the app boots and the landing page renders", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");

  await expect(page).toHaveTitle(/Consflow/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("signing in and signing up are reachable", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();

  await page.goto("/signup");
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("an unknown route renders the 404 rather than crashing", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.getByText(/page not found/i)).toBeVisible();
});

test("the dark palette is applied when the system asks for it", async ({ browser }) => {
  const dark = await browser.newContext({ colorScheme: "dark" });
  const page = await dark.newPage();
  await page.goto("/login");

  await expect(page.locator("html")).toHaveClass(/dark/);

  // The token block, not just the class: a mismatched custom-variant selector
  // would leave the class on and the colours light.
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = background.match(/\d+/g)!.map(Number);
  expect((r + g + b) / 3).toBeLessThan(80);

  await dark.close();
});

test("the light palette is applied when the system asks for it", async ({ browser }) => {
  const light = await browser.newContext({ colorScheme: "light" });
  const page = await light.newPage();
  await page.goto("/login");

  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = background.match(/\d+/g)!.map(Number);
  expect((r + g + b) / 3).toBeGreaterThan(200);

  await light.close();
});
