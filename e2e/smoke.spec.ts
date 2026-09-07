import { expect, test, type Page } from "@playwright/test";

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

/**
 * Resolves whatever the browser reports — rgb(), lab(), oklch(), color() — into
 * sRGB by painting it. Scraping digits out of the serialised string is not
 * stable: the same tokens serialise as rgb() in one Chromium and lab() in the
 * next, which is exactly how this test broke once already.
 */
async function bodyLightness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const colour = getComputedStyle(document.body).backgroundColor;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return (r + g + b) / 3;
  });
}

test("the dark palette is applied when the system asks for it", async ({ browser }) => {
  const dark = await browser.newContext({ colorScheme: "dark" });
  const page = await dark.newPage();
  await page.goto("/login");

  await expect(page.locator("html")).toHaveClass(/dark/);
  // The tokens, not just the class: a mismatched custom-variant selector would
  // leave the class on and every colour light.
  expect(await bodyLightness(page)).toBeLessThan(80);

  await dark.close();
});

test("the light palette is applied when the system asks for it", async ({ browser }) => {
  const light = await browser.newContext({ colorScheme: "light" });
  const page = await light.newPage();
  await page.goto("/login");

  await expect(page.locator("html")).not.toHaveClass(/dark/);
  expect(await bodyLightness(page)).toBeGreaterThan(200);

  await light.close();
});
