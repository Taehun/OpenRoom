import { expect, test } from "@playwright/test";

test("renders the Nook shell and a live deterministic demo route", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "The room becomes the storefront." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open deterministic demo" }),
  ).toHaveAttribute("href", "/demo");
});
