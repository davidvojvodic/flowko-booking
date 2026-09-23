import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import { APP_NAME, WEBSITE_PRIVACY_POLICY_URL, WEBSITE_TERMS_URL } from "@calcom/lib/constants";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingFormPrivacyNotice } from "./BookingFormPrivacyNotice";

const locale = vi.hoisted(() => ({ strings: {} as Record<string, string> }));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({
    t: (key: string, options: Record<string, unknown> = {}) =>
      (locale.strings[key] ?? key).replace(/{{\s*(\w+)\s*}}/g, (_match: string, name: string) =>
        String(options[name])
      ),
  }),
}));

describe("BookingFormPrivacyNotice", () => {
  beforeEach(() => {
    locale.strings = en as unknown as Record<string, string>;
  });

  it("says the booker's details are processed on the business's behalf and links only the privacy notice", () => {
    const { container } = render(<BookingFormPrivacyNotice />);

    expect(container).toHaveTextContent(
      `Your details are processed by ${APP_NAME} on behalf of the business you are booking with. Privacy notice`
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Privacy notice");
    expect(links[0]).toHaveAttribute("href", WEBSITE_PRIVACY_POLICY_URL);
    expect(container.querySelector(`a[href="${WEBSITE_TERMS_URL}"]`)).toBeNull();
  });

  it("renders the Slovenian notice with the privacy link", () => {
    locale.strings = sl as unknown as Record<string, string>;

    const { container } = render(<BookingFormPrivacyNotice />);

    expect(container).toHaveTextContent(
      `Vaše podatke v imenu ponudnika, pri katerem rezervirate, obdeluje ${APP_NAME}. Obvestilo o zasebnosti`
    );
    expect(screen.getByRole("link", { name: "Obvestilo o zasebnosti" })).toHaveAttribute(
      "href",
      WEBSITE_PRIVACY_POLICY_URL
    );
  });
});
