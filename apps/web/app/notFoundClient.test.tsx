import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFound } from "./notFoundClient";

const state = vi.hoisted(() => ({
  pathname: "/",
  strings: {} as Record<string, string>,
  missing: [] as string[],
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({
    t: (key: string) => {
      const value = state.strings[key];
      if (value === undefined) {
        state.missing.push(key);
        return key;
      }
      return value;
    },
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const locales = [
  ["en", en],
  ["sl", sl],
] as const;

// Upstream's 404 upsells: the "username is still available" claim, register links and the cal.com
// "Popular pages" (docs, blog).
const upsellKeys = [
  "404_the_user",
  "is_still_available",
  "register_now",
  "register",
  "404_claim_entity_user",
  "popular_pages",
  "documentation",
  "documentation_description",
  "blog",
  "blog_description",
] as const;

function renderAt(pathname: string, strings: Record<string, string>) {
  state.pathname = pathname;
  state.strings = strings;
  return render(<NotFound host="booking.example.com" />);
}

describe("NotFound (Flowko)", () => {
  beforeEach(() => {
    state.missing = [];
    delete (window as { CalComPageStatus?: string }).CalComPageStatus;
  });

  describe.each(locales)("in %s", (_name, strings) => {
    const dict = strings as unknown as Record<string, string>;

    it("titles a missing booking with the translated booking_not_found", () => {
      renderAt("/booking/3b1f0f0e-0000-4000-8000-000000000000", dict);

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(dict.booking_not_found);
      expect(screen.getByText(dict.check_spelling_mistakes_or_go_back)).toBeInTheDocument();
      expect(state.missing).toEqual([]);
    });

    it.each([
      "/salon-lepota",
      "/salon-lepota/strizenje",
      "/cancellation",
    ])("answers %s with the plain page-not-found text and no username upsell", (pathname) => {
      const { container } = renderAt(pathname, dict);

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(dict.page_doesnt_exist);
      expect(screen.getByText(dict.check_spelling_mistakes_or_go_back)).toBeInTheDocument();
      for (const key of upsellKeys) {
        expect(container.textContent).not.toContain(dict[key]);
      }
      expect(container.textContent).not.toContain(pathname);
      expect(state.missing).toEqual([]);
    });

    it("offers only one link, home to this app's root", () => {
      const { container } = renderAt("/salon-lepota", dict);

      const links = Array.from(container.querySelectorAll("a"));
      expect(links.map((link) => link.getAttribute("href"))).toEqual(["/"]);
      expect(links[0]).toHaveTextContent(dict.or_go_back_home);
    });
  });

  it("never renders the hardcoded English booking heading in Slovenian", () => {
    const { container } = renderAt("/booking/unknown-uid", sl as unknown as Record<string, string>);

    expect(container.textContent).not.toContain("Booking not found");
    expect(container.textContent).toContain(sl.booking_not_found);
  });

  it("links nowhere near cal.com", () => {
    const { container } = renderAt("/booking/unknown-uid", en as unknown as Record<string, string>);

    expect(container.innerHTML).not.toMatch(/cal\.com/i);
  });

  it("still reports the 404 status to the embed", () => {
    renderAt("/salon-lepota", en as unknown as Record<string, string>);

    expect((window as { CalComPageStatus?: string }).CalComPageStatus).toBe("404");
  });

  it("keeps the 404 test id the E2E helper looks for", () => {
    renderAt("/salon-lepota", en as unknown as Record<string, string>);

    expect(screen.getByTestId("404-page")).toBeInTheDocument();
  });
});
