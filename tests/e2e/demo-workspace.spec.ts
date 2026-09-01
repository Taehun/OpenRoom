import { expect, test } from "@playwright/test";

test("completes the deterministic spatial commerce UI journey", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/demo");

  const appIcon = page.locator('link[rel="icon"]');
  await expect(appIcon).toHaveAttribute("href", /\/icon\.svg/);
  const appIconHref = await appIcon.getAttribute("href");
  if (!appIconHref) throw new Error("Missing app icon href");
  expect((await page.request.get(appIconHref)).ok()).toBe(true);

  const stage = page.getByRole("region", { name: "Editable room photo" });
  const objectRail = page.getByRole("region", { name: "Objects in room" });
  await expect(stage).toBeVisible();
  await expect(objectRail).toBeVisible();
  const stageBounds = await stage.boundingBox();
  if (!stageBounds) throw new Error("Missing editable photo bounds");
  expect(stageBounds.width / stageBounds.height).toBeCloseTo(16 / 9, 2);
  await expect(stage.locator("img")).toHaveCount(6);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(
    stage.getByRole("button", {
      name: /sofa|coffee table|rug|floor lamp|chair|plant/i,
    }),
  ).toHaveCount(6);
  await expect(
    objectRail.getByRole("button", {
      name: /sofa|coffee table|rug|floor lamp|chair|plant/i,
    }),
  ).toHaveCount(6);
  await expect(
    page.getByRole("heading", { name: "Object inspector" }),
  ).toBeVisible();
  await objectRail.getByRole("button", { name: "Chair" }).click();
  await expect(page.getByText("Lounge chair")).toBeVisible();
  await page.getByRole("button", { name: "Move tool" }).click();
  await expect(page.getByRole("button", { name: "Move tool" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await stage.getByRole("button", { name: "Coffee table" }).click();
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
  await page.keyboard.press("Control+z");
  await expect(
    page.getByRole("status", { name: "Scene diagnostics" }),
  ).toContainText("Revision 1 · table_01 · placeholder");
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
