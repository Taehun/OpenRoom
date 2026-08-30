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
});

test("opens a four-item approval sheet and confirms without an external cart request", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(screen.getByRole("button", { name: "View cart" }));

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
  expect(fetchSpy).not.toHaveBeenCalled();
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

  await user.keyboard("{Control>}z{/Control}");
  expect(
    screen.getByRole("heading", { name: "Object inspector" }),
  ).toBeVisible();
  expect(screen.getByText("Revision 1")).toBeVisible();
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
    screen.queryByText("Previewing Oak Frame Table"),
  ).not.toBeInTheDocument();
});
