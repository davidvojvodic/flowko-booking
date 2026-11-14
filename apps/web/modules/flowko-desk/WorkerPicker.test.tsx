// Flowko U29g: the week view's worker picker. The chosen worker is Flowko purple with white text (as the U29f date
// picker), never Cal's black „inverted“ style; the others stay plain.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkerPicker } from "./WorkerPicker";
import { localeT } from "./desk.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const workers = [
  { memberId: 2, displayName: "Demo delavec" },
  { memberId: 3, displayName: "Testna Mojca" },
];
const tokens = (el: HTMLElement) => el.className.split(/\s+/);

afterEach(cleanup);

describe("WorkerPicker", () => {
  it("draws the chosen worker in Flowko purple with white text, never black", () => {
    render(<WorkerPicker workers={workers} value={3} onChange={vi.fn()} />);
    const chosen = screen.getByRole("radio", { name: "Testna Mojca" });
    expect(chosen.getAttribute("aria-checked")).toBe("true");
    expect(tokens(chosen)).toEqual(expect.arrayContaining(["bg-brand-default", "text-brand", "border-brand-default"]));
    expect(tokens(chosen)).not.toContain("bg-inverted");
    expect(tokens(chosen)).not.toContain("text-inverted");
    expect(tokens(chosen)).not.toContain("border-inverted");
  });

  it("keeps the other workers plain and switches on a tap", () => {
    const onChange = vi.fn();
    render(<WorkerPicker workers={workers} value={3} onChange={onChange} />);
    const other = screen.getByRole("radio", { name: "Demo delavec" });
    expect(other.getAttribute("aria-checked")).toBe("false");
    expect(tokens(other)).toEqual(expect.arrayContaining(["bg-default", "text-default", "border-default"]));
    expect(tokens(other)).not.toContain("bg-brand-default");
    fireEvent.click(other);
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
