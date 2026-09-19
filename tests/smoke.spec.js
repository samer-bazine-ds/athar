import { test, expect } from "@playwright/test";

function recordPageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("login page loads the authentication form without runtime errors", async ({ page }) => {
  const errors = recordPageErrors(page);
  await page.goto("/login.html");
  await expect(page.getByRole("heading", { name: "Welcome to The Workspace" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  expect(errors).toEqual([]);
});

test("shared UI utilities sanitize content and describe expected auth errors", async ({ page }) => {
  await page.goto("/login.html");
  const result = await page.evaluate(async () => {
    const utils = await import("/js/core/utils.js");
    const ui = await import("/js/core/ui.js");
    return {
      sanitized: utils.sanitizeHtml('<p onclick="alert(1)">Safe<script>alert(1)</script><a href="javascript:alert(1)">link</a></p>'),
      authError: ui.describeError({ code: "invalid_credentials", message: "Invalid login credentials" }),
      databaseError: ui.describeError({ code: "23505", message: "duplicate key" })
    };
  });
  expect(result.sanitized).toBe('<p>Safe<a rel="noopener noreferrer nofollow" target="_blank">link</a></p>');
  expect(result.authError).toBe("The email or password is incorrect.");
  expect(result.databaseError).toBe("That already exists.");
});

for (const entryPoint of ["/index.html", "/client-view.html"]) {
  test(`${entryPoint} redirects signed-out users to login`, async ({ page }) => {
    const errors = recordPageErrors(page);
    await page.goto(entryPoint);
    await expect(page).toHaveURL(/\/login\.html$/);
    await expect(page.getByRole("heading", { name: "Welcome to The Workspace" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
