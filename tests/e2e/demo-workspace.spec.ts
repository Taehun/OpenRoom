import { expect, test } from "@playwright/test";

test("completes the deterministic spatial commerce UI journey", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/demo");

  await expect(
    page.getByRole("heading", { name: "Object inspector" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Find alternatives" }).click();
  await page.getByRole("button", { name: "Preview Oak Frame Table" }).click();
  await expect(page.getByText("Previewing Oak Frame Table")).toBeVisible();
  await page.getByRole("button", { name: "Run Agent move" }).click();
  await expect(
    page.getByRole("heading", { name: "Agent activity" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View cart" }).click();
  const dialog = page.getByRole("dialog", { name: "Review your room" });
  await expect(dialog.getByRole("listitem")).toHaveCount(4);
  await expect(
    dialog.getByRole("button", { name: "Continue to Shopify · $626" }),
  ).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(consoleErrors).toEqual([]);
});
