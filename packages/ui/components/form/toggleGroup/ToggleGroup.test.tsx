import { TooltipProvider } from "@radix-ui/react-tooltip";
import { render, screen } from "@testing-library/react";

import { ToggleGroup } from "./ToggleGroup";

// Flowko U19: icon-only items (empty label) take their tooltip as the accessible name.
describe("ToggleGroup accessible names", () => {
  const renderGroup = (options: Parameters<typeof ToggleGroup>[0]["options"]) =>
    render(
      <TooltipProvider>
        <ToggleGroup value="list" options={options} />
      </TooltipProvider>
    );

  test("an icon-only item is named by its tooltip", () => {
    renderGroup([
      { value: "list", label: "", tooltip: "Seznam", iconLeft: <svg /> },
      { value: "calendar", label: "", tooltip: "Koledar", iconLeft: <svg /> },
    ]);
    expect(screen.getByRole("radio", { name: "Seznam" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Koledar" })).toBeInTheDocument();
  });

  test("an item with a text label keeps the label as its name", () => {
    renderGroup([{ value: "list", label: "Seznam", tooltip: "Prikaži seznam" }]);
    const item = screen.getByRole("radio", { name: "Seznam" });
    expect(item).not.toHaveAttribute("aria-label");
  });
});
