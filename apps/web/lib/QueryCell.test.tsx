import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lang: "sl" as "sl" | "en" }));

vi.mock("@calcom/lib/hooks/useLocale", async () => {
  const { realTranslator } = await import("@calcom/lib/testUtils/realTranslator");
  return { useLocale: () => ({ ...realTranslator(mocks.lang), isLocaleReady: true }) };
});

import { QueryCell } from "./QueryCell";

const failedQuery = { status: "error", error: { message: "boom" } } as never;

describe("QueryCell error state (Flowko U14)", () => {
  it("says the alert title in Slovene", () => {
    mocks.lang = "sl";
    render(<QueryCell query={failedQuery} success={() => null} />);
    expect(screen.getByText("Nekaj je šlo narobe.")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("says it in English with en", () => {
    mocks.lang = "en";
    render(<QueryCell query={failedQuery} success={() => null} />);
    expect(screen.getByText("Something went wrong.")).toBeTruthy();
  });
});
