import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoreChip } from "../../src/features/demo/store-chip";
import type { CommerceController } from "../../src/features/commerce/use-commerce-context";
import type { ProbeOutcome } from "../../src/features/commerce/store-probe";

afterEach(cleanup);

function controllerFor(
  storeDomain: string | null,
  setStoreDomain = vi.fn(() => true),
): CommerceController {
  return {
    commerce: {
      config:
        storeDomain === null
          ? { status: "unconfigured", reason: "not-configured" }
          : {
              status: "connected",
              storeDomain,
              mcpEndpoint: `https://${storeDomain}/api/ucp/mcp`,
              agentProfileUrl: null,
            },
      variants: {},
    },
    hydrated: true,
    storedDomain: storeDomain,
    setStoreDomain,
  };
}

const ok = vi.fn(async (): Promise<ProbeOutcome> => ({ status: "ok", tools: [] }));

describe("StoreChip", () => {
  it("shows the connected store", () => {
    render(<StoreChip controller={controllerFor("openroom-x.myshopify.com")} probe={ok} />);
    expect(screen.getByRole("button", { name: /openroom-x\.myshopify\.com/ })).toBeVisible();
  });

  it("holds a neutral label until storage has been read", () => {
    const controller = controllerFor("openroom-x.myshopify.com");
    render(<StoreChip controller={{ ...controller, hydrated: false }} probe={ok} />);
    expect(screen.getByRole("button", { name: "Store" })).toBeVisible();
    expect(screen.queryByText("openroom-x.myshopify.com")).toBeNull();
  });

  it("invites a connection when there is no store", () => {
    render(<StoreChip controller={controllerFor(null)} probe={ok} />);
    expect(screen.getByRole("button", { name: "Connect a store" })).toBeVisible();
  });

  it("rejects a malformed address without probing", async () => {
    const setStoreDomain = vi.fn(() => true);
    const probe = vi.fn(async (): Promise<ProbeOutcome> => ({ status: "ok", tools: [] }));
    render(<StoreChip controller={controllerFor(null, setStoreDomain)} probe={probe} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "openroom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Add the full address, like openroom.myshopify.com"),
    ).toBeVisible();
    expect(probe).not.toHaveBeenCalled();
    expect(setStoreDomain).not.toHaveBeenCalled();
  });

  it("saves a store that offers the cart tools", async () => {
    const setStoreDomain = vi.fn(() => true);
    render(<StoreChip controller={controllerFor(null, setStoreDomain)} probe={ok} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "https://Chosen.myshopify.com/admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setStoreDomain).toHaveBeenCalledWith("chosen.myshopify.com");
    });
  });

  it("saves with a warning when the cart tools are missing", async () => {
    const setStoreDomain = vi.fn(() => true);
    const probe = vi.fn(async (): Promise<ProbeOutcome> => ({
      status: "missing-cart-tools",
      tools: ["search_shop_policies_and_faqs"],
    }));
    render(<StoreChip controller={controllerFor(null, setStoreDomain)} probe={probe} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "chosen.myshopify.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/does not offer cart tools/)).toBeVisible();
    expect(setStoreDomain).toHaveBeenCalledWith("chosen.myshopify.com");
  });

  it("refuses to save a store it cannot reach", async () => {
    const setStoreDomain = vi.fn(() => true);
    const probe = vi.fn(async (): Promise<ProbeOutcome> => ({ status: "unreachable" }));
    render(<StoreChip controller={controllerFor(null, setStoreDomain)} probe={probe} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "chosen.myshopify.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Could not reach a Shopify store/)).toBeVisible();
    expect(setStoreDomain).not.toHaveBeenCalled();
  });

  it("says so when the browser will not remember the store", async () => {
    const setStoreDomain = vi.fn(() => false);
    render(<StoreChip controller={controllerFor(null, setStoreDomain)} probe={ok} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "chosen.myshopify.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This browser will not remember the store"),
    ).toBeVisible();
  });

  it("returns to the sample store", () => {
    const setStoreDomain = vi.fn(() => true);
    render(
      <StoreChip
        controller={controllerFor("chosen.myshopify.com", setStoreDomain)}
        probe={ok}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /chosen\.myshopify\.com/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use the sample store" }));
    expect(setStoreDomain).toHaveBeenCalledWith(null);
  });

  // The spec asks for validation as you type but a message only on blur or
  // Save; judging a half-typed domain is noise.
  it("stays quiet while the address is being typed", () => {
    const probe = vi.fn(async (): Promise<ProbeOutcome> => ({ status: "ok", tools: [] }));
    render(<StoreChip controller={controllerFor(null)} probe={probe} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));

    const field = screen.getByLabelText("Store address");
    fireEvent.change(field, { target: { value: "open" } });
    expect(screen.queryByText(/Add the full address/)).toBeNull();
    expect(probe).not.toHaveBeenCalled();

    fireEvent.blur(field);
    expect(screen.getByText("Add the full address, like openroom.myshopify.com")).toBeVisible();
    expect(probe).not.toHaveBeenCalled();
  });

  it("closes on Escape and returns focus to the chip", () => {
    render(<StoreChip controller={controllerFor(null)} probe={ok} />);
    const chip = screen.getByRole("button", { name: "Connect a store" });
    fireEvent.click(chip);
    expect(screen.getByLabelText("Store address")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByLabelText("Store address")).toBeNull();
    expect(chip).toHaveFocus();
  });

  it("keeps keyboard focus inside the popover", () => {
    render(<StoreChip controller={controllerFor(null)} probe={ok} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close store settings" });
    const save = screen.getByRole("button", { name: "Save" });

    close.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  it("supports a parent-controlled open state", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <StoreChip
          controller={controllerFor(null)}
          onOpenChange={setOpen}
          open={open}
          probe={ok}
        />
      );
    }

    render(<Harness />);
    const chip = screen.getByRole("button", { name: "Connect a store" });
    fireEvent.click(chip);
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chip).toHaveFocus();
  });

  it("ignores an older probe after the popover is closed and reopened", async () => {
    const setStoreDomain = vi.fn(() => true);
    const resolvers: Array<(outcome: ProbeOutcome) => void> = [];
    const probe = vi.fn(
      () => new Promise<ProbeOutcome>((resolve) => resolvers.push(resolve)),
    );
    render(<StoreChip controller={controllerFor(null, setStoreDomain)} probe={probe} />);

    const chip = screen.getByRole("button", { name: "Connect a store" });
    fireEvent.click(chip);
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "first.myshopify.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    fireEvent.click(chip);
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "second.myshopify.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await act(async () => {
      resolvers[1]!({ status: "ok", tools: [] });
    });
    await waitFor(() => {
      expect(setStoreDomain).toHaveBeenCalledWith("second.myshopify.com");
    });

    await act(async () => {
      resolvers[0]!({ status: "ok", tools: [] });
    });
    expect(setStoreDomain).toHaveBeenCalledTimes(1);
  });

  it("does not save when an in-flight probe resolves after unmount", async () => {
    const setStoreDomain = vi.fn(() => true);
    let resolveProbe: ((outcome: ProbeOutcome) => void) | undefined;
    const probe = vi.fn(
      () =>
        new Promise<ProbeOutcome>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const view = render(
      <StoreChip controller={controllerFor(null, setStoreDomain)} probe={probe} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "chosen.myshopify.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    view.unmount();

    await act(async () => {
      resolveProbe?.({ status: "ok", tools: [] });
    });
    expect(setStoreDomain).not.toHaveBeenCalled();
  });
});
