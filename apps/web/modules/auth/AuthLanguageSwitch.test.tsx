import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthLanguageSwitch } from "./AuthLanguageSwitch";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: Record<string, never>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const hrefs = () => ({
  sl: screen.getByRole("link", { name: "SL" }).getAttribute("href") as string,
  en: screen.getByRole("link", { name: "EN" }).getAttribute("href") as string,
});

describe("AuthLanguageSwitch (Flowko U14)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("links both languages from a plain page", () => {
    render(<AuthLanguageSwitch pathname="/auth/login" searchParams={{}} />);

    expect(hrefs()).toEqual({ sl: "/auth/login", en: "/auth/login?lang=en" });
  });

  it("keeps callbackUrl and the other parameters, in both links", () => {
    const callbackUrl = "https://booking.example.com/event-types?a=1&b=2";
    render(
      <AuthLanguageSwitch
        pathname="/auth/login"
        searchParams={{ callbackUrl, lang: "en", email: "ana@example.com" }}
      />
    );

    const sl = new URL(hrefs().sl, "https://x.example.com");
    const en = new URL(hrefs().en, "https://x.example.com");
    expect(sl.searchParams.get("callbackUrl")).toBe(callbackUrl);
    expect(sl.searchParams.get("email")).toBe("ana@example.com");
    expect(sl.searchParams.has("lang")).toBe(false);
    expect(en.searchParams.get("callbackUrl")).toBe(callbackUrl);
    expect(en.searchParams.get("lang")).toBe("en");
    expect(en.searchParams.getAll("lang")).toHaveLength(1);
  });

  it("keeps a repeated parameter repeated", () => {
    render(<AuthLanguageSwitch pathname="/auth/login" searchParams={{ a: ["1", "2"], b: undefined }} />);

    expect(hrefs().sl).toBe("/auth/login?a=1&a=2");
  });

  it.each([
    ["?lang=de", "de"],
    ["?lang=../x", "../x"],
    ["?lang=en&lang=sl", ["en", "sl"]],
  ])("treats %s as Slovene and drops it from both links", (_kind, lang) => {
    render(<AuthLanguageSwitch pathname="/auth/login" searchParams={{ lang }} />);

    expect(hrefs()).toEqual({ sl: "/auth/login", en: "/auth/login?lang=en" });
    expect(screen.getByRole("link", { name: "SL" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "EN" })).not.toHaveAttribute("aria-current");
  });

  it("marks English active and names each link's language", () => {
    render(<AuthLanguageSwitch pathname="/auth/forgot-password/abc" searchParams={{ lang: "en" }} />);

    const en = screen.getByRole("link", { name: "EN" });
    const sl = screen.getByRole("link", { name: "SL" });
    expect(en).toHaveAttribute("aria-current", "true");
    expect(sl).not.toHaveAttribute("aria-current");
    expect(en).toHaveAttribute("lang", "en");
    expect(sl).toHaveAttribute("lang", "sl");
    expect(en.getAttribute("href")).toBe("/auth/forgot-password/abc?lang=en");
    expect(screen.getByRole("navigation", { name: "language_switcher_label" })).toBeInTheDocument();
  });
});
