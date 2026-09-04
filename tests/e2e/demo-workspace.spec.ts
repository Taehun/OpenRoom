import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __demoClipboardShouldReject: boolean;
  }
}

function expectStableBounds(
  before: { x: number; y: number; width: number; height: number },
  after: { x: number; y: number; width: number; height: number },
) {
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
}

test("keeps prompt feedback from reflowing the copy button or photo stage", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__demoClipboardShouldReject = false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText() {
          if (window.__demoClipboardShouldReject) {
            throw new DOMException("Denied", "NotAllowedError");
          }
        },
      },
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/demo");

  const copyButton = page.getByRole("button", {
    name: "Copy redesign prompt",
  });
  const stage = page.getByRole("region", { name: "Editable room photo" });
  const beforeButton = await copyButton.boundingBox();
  const beforeStage = await stage.boundingBox();
  if (!beforeButton || !beforeStage) throw new Error("Missing initial bounds");

  await copyButton.click();
  await expect(
    page.getByRole("status", { name: "Prompt copy status" }),
  ).toHaveText("Prompt copied");
  const afterSuccessButton = await copyButton.boundingBox();
  const afterSuccessStage = await stage.boundingBox();
  if (!afterSuccessButton || !afterSuccessStage) {
    throw new Error("Missing success bounds");
  }
  expectStableBounds(beforeButton, afterSuccessButton);
  expectStableBounds(beforeStage, afterSuccessStage);

  await page.evaluate(() => {
    window.__demoClipboardShouldReject = true;
  });
  await copyButton.click();
  await expect(
    page.getByRole("status", { name: "Prompt copy status" }),
  ).toHaveText("Could not copy. Select and copy the prompt manually.");
  const afterFailureButton = await copyButton.boundingBox();
  const afterFailureStage = await stage.boundingBox();
  if (!afterFailureButton || !afterFailureStage) {
    throw new Error("Missing failure bounds");
  }
  expectStableBounds(beforeButton, afterFailureButton);
  expectStableBounds(beforeStage, afterFailureStage);
});

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
    page.getByRole("heading", { name: "Coffee table" }),
  ).toBeVisible();
  await objectRail.getByRole("button", { name: "Chair" }).click();
  await expect(page.getByRole("heading", { name: "Chair" })).toBeVisible();
  await page.getByRole("button", { name: "Move tool" }).click();
  await expect(page.getByRole("button", { name: "Move tool" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await stage.getByRole("button", { name: "Coffee table" }).click();
  await page.getByRole("button", { name: "Find alternatives" }).click();
  await page.getByRole("button", { name: "Place Oak Frame Table in room" }).click();
  await expect(
    page.getByRole("main", { name: "Room canvas" }).getByText("Oak Frame Table"),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(
    page.getByRole("status", { name: "Scene diagnostics" }),
  ).toContainText("Revision 1 · table_01 · placeholder");
  // The cart is the room. The reset seed room holds placeholders only, so the
  // header carries no badge and the sheet says so instead of inventing lines.
  const viewCart = page.getByRole("button", { name: "View cart" });
  await expect(viewCart).toHaveText("View cart");
  await viewCart.click();
  const dialog = page.getByRole("dialog", { name: "Review your room" });
  await expect(dialog.getByRole("listitem")).toHaveCount(0);
  await expect(
    dialog.getByText(
      "Nothing to order yet. Add products with Find alternatives or ask your AI app.",
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Approve demo cart", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Put one catalog product in the room and the cart follows it.
  await page.getByRole("button", { name: "Find alternatives" }).click();
  await page.getByRole("button", { name: "Place Oak Frame Table in room" }).click();
  await expect(viewCart).toHaveText("View cart1");
  await viewCart.click();
  await expect(dialog.getByRole("listitem")).toHaveCount(1);
  await expect(dialog.getByText("Oak Frame Table")).toBeVisible();
  await expect(dialog.getByText("$169 USD")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Approve demo cart · $169" }),
  ).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

test("keeps the room across a soft navigation to the home page and back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/demo");

  const diagnostics = page.getByRole("status", { name: "Scene diagnostics" });
  const roomCanvas = page.getByRole("main", { name: "Room canvas" });
  const viewCart = page.getByRole("button", { name: "View cart" });
  await expect(roomCanvas).toBeVisible();

  await page.getByRole("button", { name: "Find alternatives" }).click();
  await page
    .getByRole("button", { name: "Place Oak Frame Table in room" })
    .click();
  await expect(roomCanvas.getByText("Oak Frame Table")).toBeVisible();
  await expect(diagnostics).toContainText("Revision 2");
  await expect(viewCart).toHaveText("View cart1");

  // The header wordmark is a `next/link`, so this is a soft navigation: the
  // workspace unmounts, and only a store outside the route subtree survives
  // it. Playwright's Chromium has no WebMCP, so `/` renders the guide.
  await page.getByRole("link", { name: "OpenRoom home" }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("region", { name: "WebMCP in this browser" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Open the demo" }).first().click();
  await expect(page).toHaveURL("/demo");
  await expect(roomCanvas.getByText("Oak Frame Table")).toBeVisible();
  await expect(diagnostics).toContainText("Revision 2");
  await expect(viewCart).toHaveText("View cart1");
});

// QA regression: the rotation handle sits on the silhouette's top edge, inside
// the cutout's box, so it has to stay above the cutout for pointer input.
test("drags the rotation handle to turn a piece without moving it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo");
  const stage = page.getByRole("region", { name: "Editable room photo" });
  await stage.getByRole("button", { name: "Sofa" }).click();
  await page.getByRole("button", { name: "Rotate tool" }).click();

  const frame = page.getByTestId("photo-object-frame-sofa_01");
  const readPosition = (node: HTMLElement) => [
    Number.parseFloat(node.style.left),
    Number.parseFloat(node.style.top),
  ];
  const before = await frame.evaluate(readPosition);
  const faces = page.locator("dt", { hasText: "Faces" }).locator("xpath=following-sibling::dd[1]");
  await expect(faces).toHaveText("Toward the camera");

  const handle = page.getByTestId("rotation-handle-sofa_01");
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing rotation handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 10 });
  await page.mouse.up();

  await expect(faces).not.toHaveText("Toward the camera");
  await expect(faces).toContainText("Turned");
  // The footprint clamp may nudge a turned piece by a point or two; a drag
  // that moved it instead of turning it shifts it by far more.
  const after = await frame.evaluate(readPosition);
  expect(Math.abs(after[0]! - before[0]!)).toBeLessThan(3);
  expect(Math.abs(after[1]! - before[1]!)).toBeLessThan(3);
});
