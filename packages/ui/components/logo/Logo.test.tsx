import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Logo } from "./Logo";

vi.mock("@calcom/lib/constants", () => ({ APP_NAME: "Flowko" }));

describe("Logo", () => {
  it("names the logo after the app", () => {
    render(<Logo />);

    const logo = screen.getByRole("img");
    expect(logo).toHaveAttribute("alt", "Flowko");
    expect(logo).toHaveAttribute("title", "Flowko");
  });

  it("names the icon after the app", () => {
    render(<Logo icon />);

    const icon = screen.getByRole("img");
    expect(icon).toHaveAttribute("alt", "Flowko");
    expect(icon).toHaveAttribute("title", "Flowko");
  });
});
