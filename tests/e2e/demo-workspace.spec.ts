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
    page.getByRole("region", { name: "Editable room photo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /sofa|coffee table|rug|floor lamp|chair|plant/i,
    }),
  ).toHaveCount(6);
  await expect(
    page.getByRole("heading", { name: "Object inspector" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Chair" }).click();
  await expect(page.getByText("Lounge chair")).toBeVisible();
  await page.getByRole("button", { name: "Move tool" }).click();
  await expect(page.getByRole("button", { name: "Move tool" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Coffee table" }).click();
  await page.getByRole("button", { name: "Find alternatives" }).click();
  await page.getByRole("button", { name: "Preview Oak Frame Table" }).click();
  await expect(page.getByText("Previewing Oak Frame Table")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run Agent move" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Copy redesign prompt" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Scene diagnostics" }),
  ).toContainText("Revision 2");
  await page.getByRole("button", { name: "Reset Demo" }).click();
  await expect(
    page.getByRole("status", { name: "Scene diagnostics" }),
  ).toContainText("Revision 1 · table_01 · placeholder");
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
