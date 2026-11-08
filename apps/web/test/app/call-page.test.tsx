// Flowko U27: the call-the-business page (/poklicite/<business slug>) a worker's Cal pages redirect to. Shows the
// business's name, phone (tel: link) and address; no customer data. This file lives outside apps/web/app on
// purpose: pagesAndRewritePaths.ts scans the file names there as top-level routes. Real translations
// (packages/i18n/locales); only the business lookup and the request locale are mocked.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  locale: "sl",
  throwLocale: false,
  businesses: {} as Record<string, { name: string; phone: string | null; address: string | null }>,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], get: () => undefined }),
}));
vi.mock("@calcom/features/auth/lib/getLocale", () => ({
  getLocale: vi.fn(async () => {
    if (mocks.throwLocale) throw new Error("locale lookup failed");
    return mocks.locale;
  }),
}));
vi.mock("@lib/flowko/callPage", () => ({
  loadCallPageBusiness: vi.fn(async (slug: string) => mocks.businesses[slug] ?? null),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

async function renderPage(slug: string) {
  const { default: Page } = await import("app/(booking-page-wrapper)/poklicite/[slug]/page");
  const element = (await Page({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({}),
  })) as ReactElement;
  return render(element);
}

describe("/poklicite/<slug> call page (Flowko U27)", () => {
  beforeEach(() => {
    mocks.locale = "sl";
    mocks.throwLocale = false;
    mocks.businesses = {
      "salon-a": { name: "Salon A", phone: "+386 1 234 56 78", address: "Slovenska cesta 1, Ljubljana" },
      "salon-b": { name: "Salon B", phone: null, address: null },
      "salon-c": { name: "Salon & Co", phone: "  ", address: "Trg 2" },
      "salon-d": { name: "Frizerstvo Maja s.p.", phone: null, address: null },
    };
  });
  afterEach(cleanup);

  it("shows the name, a tel: link on the phone and the address in Slovene", async () => {
    await renderPage("salon-a");
    expect(screen.getByRole("heading").textContent).toBe("Rezervacija termina: Salon A");
    expect(screen.getByTestId("flowko-call-body").textContent).toBe(
      "Termin lahko rezervirate, prestavite ali odpoveste po telefonu: +386 1 234 56 78."
    );
    const link = screen.getByTestId("flowko-call-phone");
    expect(link.getAttribute("href")).toBe("tel:+38612345678");
    expect(link.textContent).toBe("+386 1 234 56 78");
    expect(screen.getByTestId("flowko-call-address").textContent).toBe(
      "Naslov: Slovenska cesta 1, Ljubljana"
    );
  });

  it("speaks English when the visitor's language is English", async () => {
    mocks.locale = "en";
    await renderPage("salon-a");
    expect(screen.getByRole("heading").textContent).toBe("Booking: Salon A");
    expect(screen.getByTestId("flowko-call-body").textContent).toBe(
      "You can book, reschedule or cancel by phone: +386 1 234 56 78."
    );
    expect(screen.getByTestId("flowko-call-address").textContent).toBe(
      "Address: Slovenska cesta 1, Ljubljana"
    );
  });

  // Flowko U27 (David 2026-11-08): the businesses are Slovene, so the error / unsupported-locale path is Slovene too.
  it("falls back to Slovene, not English, when the locale lookup throws", async () => {
    mocks.throwLocale = true;
    await renderPage("salon-a");
    expect(screen.getByRole("heading").textContent).toBe("Rezervacija termina: Salon A");
    expect(screen.getByTestId("flowko-call-address").textContent).toBe(
      "Naslov: Slovenska cesta 1, Ljubljana"
    );
  });

  it("falls back to Slovene, not English, when the locale is not a supported one", async () => {
    mocks.locale = "xx";
    await renderPage("salon-a");
    expect(screen.getByRole("heading").textContent).toBe("Rezervacija termina: Salon A");
    expect(screen.getByTestId("flowko-call-body").textContent).toBe(
      "Termin lahko rezervirate, prestavite ali odpoveste po telefonu: +386 1 234 56 78."
    );
  });

  it("without a phone it says to contact the business, and shows no phone link or address", async () => {
    await renderPage("salon-b");
    expect(screen.getByTestId("flowko-call-body").textContent).toBe(
      "Za rezervacijo, prestavitev ali odpoved termina se obrnite na ponudnika storitve: Salon B."
    );
    expect(screen.queryByTestId("flowko-call-phone")).toBeNull();
    expect(screen.queryByTestId("flowko-call-address")).toBeNull();
  });

  it("a blank phone counts as no phone; an ampersand in the name is shown once-escaped, not as &amp;", async () => {
    await renderPage("salon-c");
    expect(screen.getByRole("heading").textContent).toBe("Rezervacija termina: Salon & Co");
    expect(screen.getByTestId("flowko-call-body").textContent).toBe(
      "Za rezervacijo, prestavitev ali odpoved termina se obrnite na ponudnika storitve: Salon & Co."
    );
    expect(screen.queryByTestId("flowko-call-phone")).toBeNull();
  });

  it("a name that ends with a full stop does not get a second one; the phone's full stop stays outside the link", async () => {
    await renderPage("salon-d");
    expect(screen.getByTestId("flowko-call-body").textContent).toBe(
      "Za rezervacijo, prestavitev ali odpoved termina se obrnite na ponudnika storitve: Frizerstvo Maja s.p."
    );
    cleanup();
    await renderPage("salon-a");
    expect(screen.getByTestId("flowko-call-phone").textContent).toBe("+386 1 234 56 78");
    expect(screen.getByTestId("flowko-call-body").textContent?.endsWith("78.")).toBe(true);
  });

  it("an unknown slug is not found", async () => {
    await expect(renderPage("no-such-business")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the embed page is the same page", async () => {
    const main = await import("app/(booking-page-wrapper)/poklicite/[slug]/page");
    const embed = await import("app/(booking-page-wrapper)/poklicite/[slug]/embed/page");
    expect(embed.default).toBe(main.default);
    expect(embed.generateMetadata).toBe(main.generateMetadata);
  });
});
