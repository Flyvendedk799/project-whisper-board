import { expect, test } from "@playwright/test";

/**
 * Credential-free, like the rest of the smoke suite. The plan screen itself is
 * covered by the component tests with the server functions stubbed; these make
 * sure the planner routes exist, accept the `?task=` deep link, and send a
 * signed-out visitor to sign in rather than crashing.
 */
const PLAN = "42e59bac-2151-4f3c-a470-1854c4aea567";
const TASK = "9a1c6f4e-3d2b-4f7a-8c55-0b7d2e1a9f10";

test("a plan link with a task deep link sends a signed-out visitor to sign in", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`/app/planner/${PLAN}?task=${TASK}`);

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel("Email")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a malformed task parameter is ignored instead of breaking the route", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`/app/planner/${PLAN}?task=not-a-uuid`);

  await expect(page).toHaveURL(/\/login/);
  expect(errors).toEqual([]);
});

test("the plans list route exists", async ({ page }) => {
  await page.goto("/app/planner");
  await expect(page).toHaveURL(/\/login/);
});
