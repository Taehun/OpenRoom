import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import Home from "../../app/page";

test("renders the Nook heading and a future-facing demo route", () => {
  render(<Home />);

  expect(
    screen.getByRole("heading", { name: "The room becomes the storefront." }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Deterministic demo coming soon" }),
  ).toHaveAttribute("href", "/demo");
});
