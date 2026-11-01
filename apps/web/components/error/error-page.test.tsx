import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Flowko U14: the error page says its text in the UI language and stays readable outside an i18n provider.

const mocks = vi.hoisted(() => ({ lang: "sl" as "sl" | "en" | "none" }));

vi.mock("@calcom/lib/hooks/useLocale", async () => {
  const { realTranslator } = await import("@calcom/lib/testUtils/realTranslator");
  return {
    useLocale: () => {
      if (mocks.lang === "none") {
        // no provider: i18next answers the key itself, or the default when one is given
        return {
          t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
        };
      }
      return realTranslator(mocks.lang);
    },
  };
});
vi.mock("@calcom/embed-core/src/embed-iframe", () => ({}));

import { ErrorPage } from "./error-page";

describe("ErrorPage", () => {
  beforeEach(() => {
    mocks.lang = "sl";
  });

  it("is Slovene with the sl file", () => {
    render(<ErrorPage statusCode={500} message="boom" />);
    expect(screen.getByText("Ne gre za vas, napaka je pri nas.")).toBeTruthy();
    expect(screen.getByText(/Na naši strani je prišlo do napake/)).toBeTruthy();
    expect(screen.getByText("Kontaktirajte podporo")).toBeTruthy();
    expect(screen.getByText("Poskusi znova")).toBeTruthy();
    expect(screen.queryByText(/not you/)).toBeNull();
  });

  it("is English with the en file", () => {
    mocks.lang = "en";
    render(<ErrorPage statusCode={500} message="boom" />);
    expect(screen.getByText("It's not you, it's us.")).toBeTruthy();
    expect(screen.getByText("Contact support")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("falls back to English text, never a key, outside an i18n provider", () => {
    mocks.lang = "none";
    render(<ErrorPage statusCode={500} message="boom" />);
    expect(screen.getByText("It's not you, it's us.")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/error_page_/);
  });
});
