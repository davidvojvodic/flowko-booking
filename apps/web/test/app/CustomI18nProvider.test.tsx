import { cleanup, render, screen } from "@testing-library/react";
import { CustomI18nContext, CustomI18nProvider } from "app/CustomI18nProvider";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Flowko U13-19: the root layout renders <html lang dir> from Accept-Language; a booker page wrapped in
// CustomI18nProvider speaks the event type's language, and <html lang> must follow it.
// This file lives outside apps/web/app on purpose: pagesAndRewritePaths.ts scans the file names there as
// top-level routes, which the framing lock and the reserved usernames then have to carry.

function LocaleProbe() {
  const context = useContext(CustomI18nContext);
  return <span data-testid="locale">{context?.locale}</span>;
}

function Page({ locale }: { locale: string }) {
  return (
    <CustomI18nProvider translations={{}} locale={locale} ns="common">
      <LocaleProbe />
    </CustomI18nProvider>
  );
}

const html = () => document.documentElement;

describe("CustomI18nProvider <html lang> (U13-19)", () => {
  beforeEach(() => {
    // What the root layout renders for a visitor whose browser asks for English
    html().setAttribute("lang", "en");
    html().setAttribute("dir", "ltr");
  });

  afterEach(() => {
    cleanup();
    html().removeAttribute("lang");
    html().removeAttribute("dir");
  });

  it("sets lang to the booker's locale under an English Accept-Language", () => {
    render(<Page locale="sl" />);
    expect(screen.getByTestId("locale").textContent).toBe("sl");
    expect(html().getAttribute("lang")).toBe("sl");
    expect(html().getAttribute("dir")).toBe("ltr");
  });

  it("keeps a region subtag and sets dir for a right-to-left locale", () => {
    const { rerender } = render(<Page locale="pt-BR" />);
    expect(html().getAttribute("lang")).toBe("pt-BR");
    expect(html().getAttribute("dir")).toBe("ltr");

    rerender(<Page locale="ar" />);
    expect(html().getAttribute("lang")).toBe("ar");
    expect(html().getAttribute("dir")).toBe("rtl");
  });

  it("puts the layout's lang and dir back when the booker page unmounts", () => {
    const { unmount } = render(<Page locale="he" />);
    expect(html().getAttribute("lang")).toBe("he");
    expect(html().getAttribute("dir")).toBe("rtl");

    unmount();
    expect(html().getAttribute("lang")).toBe("en");
    expect(html().getAttribute("dir")).toBe("ltr");
  });

  it("keeps the next page's locale when one booker page replaces another", () => {
    const { rerender, unmount } = render(<Page key="booker" locale="sl" />);
    expect(html().getAttribute("lang")).toBe("sl");

    // A new key remounts the provider, as a client-side navigation to the success page does.
    rerender(<Page key="success" locale="de" />);
    expect(html().getAttribute("lang")).toBe("de");

    unmount();
    expect(html().getAttribute("lang")).toBe("en");
  });

  it("removes attributes that the layout did not set", () => {
    html().removeAttribute("lang");
    html().removeAttribute("dir");

    const { unmount } = render(<Page locale="sl" />);
    expect(html().getAttribute("lang")).toBe("sl");

    unmount();
    expect(html().hasAttribute("lang")).toBe(false);
    expect(html().hasAttribute("dir")).toBe(false);
  });
});
