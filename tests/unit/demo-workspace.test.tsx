import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { DemoWorkspace } from "../../src/features/demo/demo-workspace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("moves from object inspection to product preview", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  expect(
    screen.getByRole("heading", { name: "Object inspector" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Find alternatives" }));

  const products = screen.getByRole("region", {
    name: "Tables for your room",
  });
  expect(within(products).getAllByRole("article")).toHaveLength(3);

  await user.click(
    screen.getByRole("button", { name: "Preview Oak Frame Table" }),
  );
  expect(screen.getByText("Previewing Oak Frame Table")).toBeVisible();
  expect(screen.getByText("Revision 2")).toBeVisible();
  expect(screen.getAllByText("$169")).not.toHaveLength(0);
  expect(
    screen.getByRole("status", { name: "Scene diagnostics" }),
  ).toHaveTextContent("Revision 2 · table_01 · oak-frame-table");
});

test("exposes the interactive 3D room and its accessible object controls", () => {
  render(<DemoWorkspace />);

  expect(
    screen.getByRole("region", { name: "Interactive 3D room" }),
  ).toBeVisible();
  expect(screen.getByRole("region", { name: "Objects in room" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Coffee table" })).toBeVisible();
});

test("uses Scene selection without incrementing revision", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(screen.getByRole("button", { name: "Chair" }));

  expect(screen.getByText("Lounge chair")).toBeVisible();
  expect(screen.getByText("Revision 1")).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Scene diagnostics" }),
  ).toHaveTextContent("Revision 1 · chair_01 · placeholder");
});

test("opens a four-item approval sheet and confirms without an external cart request", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  const viewCart = screen.getByRole("button", { name: "View cart" });
  await user.click(viewCart);

  const sheet = screen.getByRole("dialog", { name: "Review your room" });
  expect(within(sheet).getAllByRole("listitem")).toHaveLength(4);
  expect(within(sheet).getByText("$626 USD")).toBeVisible();

  await user.click(
    within(sheet).getByRole("button", {
      name: "Continue to Shopify · $626",
    }),
  );

  expect(
    screen.queryByRole("dialog", { name: "Review your room" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Demo only — no external cart was created."),
  ).toBeVisible();
  expect(viewCart).toHaveFocus();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("keeps keyboard focus inside the cart approval sheet", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(screen.getByRole("button", { name: "View cart" }));

  const sheet = screen.getByRole("dialog", { name: "Review your room" });
  const close = within(sheet).getByRole("button", {
    name: "Close cart review",
  });
  const continueToShopify = within(sheet).getByRole("button", {
    name: "Continue to Shopify · $626",
  });
  const keepEditing = within(sheet).getByRole("button", {
    name: "Keep editing",
  });

  expect(close).toHaveFocus();
  await user.tab();
  expect(continueToShopify).toHaveFocus();
  await user.tab();
  expect(keepEditing).toHaveFocus();
  await user.tab();
  expect(close).toHaveFocus();
});

test("hides the workspace from assistive technology and restores the cart trigger on close", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  const viewCart = screen.getByRole("button", { name: "View cart" });
  await user.click(viewCart);

  expect(
    screen.queryByRole("button", { name: "Run Agent move" }),
  ).not.toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "Close cart review" }),
  );
  expect(viewCart).toHaveFocus();
});

test("Escape closes the cart before clearing the selected object", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  const coffeeTable = screen.getByRole("button", { name: "Coffee table" });
  expect(coffeeTable).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: "View cart" }));
  await user.keyboard("{Escape}");
  expect(
    screen.queryByRole("dialog", { name: "Review your room" }),
  ).not.toBeInTheDocument();
  expect(coffeeTable).toHaveAttribute("aria-pressed", "true");

  await user.keyboard("{Escape}");
  expect(coffeeTable).toHaveAttribute("aria-pressed", "false");
});

test("activates move and rotate tools for Scene transforms", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  const select = screen.getByRole("button", { name: "Select tool" });
  const move = screen.getByRole("button", { name: "Move tool" });
  const rotate = screen.getByRole("button", { name: "Rotate tool" });

  expect(select).toHaveAttribute("aria-pressed", "true");
  expect(move).toBeEnabled();
  expect(rotate).toBeEnabled();

  await user.click(move);
  expect(move).toHaveAttribute("aria-pressed", "true");
  expect(select).toHaveAttribute("aria-pressed", "false");

  await user.click(rotate);
  expect(rotate).toHaveAttribute("aria-pressed", "true");
  expect(move).toHaveAttribute("aria-pressed", "false");
});

test("runs the Agent move and supports keyboard undo", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(screen.getByRole("button", { name: "Run Agent move" }));
  expect(
    screen.getByRole("heading", { name: "Agent activity" }),
  ).toBeVisible();
  expect(screen.getByText("get_scene")).toBeVisible();
  expect(screen.getByText("move_object")).toBeVisible();
  expect(screen.getByText("Lamp moved to match your layout")).toBeVisible();
  expect(screen.getByText("Revision 2")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Floor lamp" }));
  expect(screen.getByText("X 2.31 · Y 0.80 · Z −2.13")).toBeVisible();

  await user.keyboard("{Control>}z{/Control}");
  expect(
    screen.getByRole("heading", { name: "Object inspector" }),
  ).toBeVisible();
  expect(screen.getByText("Revision 1")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Floor lamp" }));
  expect(screen.getByText("X 2.73 · Y 0.80 · Z −2.13")).toBeVisible();
});

test("Reset Demo restores the canonical inspector state", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(screen.getByRole("button", { name: "Find alternatives" }));
  await user.click(
    screen.getByRole("button", { name: "Preview Oak Frame Table" }),
  );
  await user.click(screen.getByRole("button", { name: "Reset Demo" }));

  expect(
    screen.getByRole("heading", { name: "Object inspector" }),
  ).toBeVisible();
  expect(screen.getByText("Revision 1")).toBeVisible();
  expect(screen.getByText("$0")).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Scene diagnostics" }),
  ).toHaveTextContent("Revision 1 · table_01 · placeholder");
  expect(
    screen.queryByText("Previewing Oak Frame Table"),
  ).not.toBeInTheDocument();
});
