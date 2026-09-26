import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import UpgradePage from "./upgrade-view";

// Flowko: the /upgrade page's "Contact support" button mailed support@cal.com. It now mails
// SUPPORT_MAIL_ADDRESS (U12); a getter lets the test set it.
const mockConstants = vi.hoisted(() => ({ supportMailAddress: "support@example.com" }));
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  get SUPPORT_MAIL_ADDRESS(): string {
    return mockConstants.supportMailAddress;
  },
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

vi.mock("@calcom/trpc/react", () => ({ trpc: {} }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@calcom/web/modules/shell/Shell", () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

const contactSupportHref = () => screen.getByText("contact_support").closest("a")?.getAttribute("href");

describe("UpgradePage", () => {
  it("mails SUPPORT_MAIL_ADDRESS from the Contact support button", () => {
    render(<UpgradePage />);

    expect(contactSupportHref()).toBe("mailto:support@example.com");
  });

  it("follows SUPPORT_MAIL_ADDRESS when it changes", () => {
    mockConstants.supportMailAddress = "info@example.com";
    try {
      render(<UpgradePage />);

      expect(contactSupportHref()).toBe("mailto:info@example.com");
    } finally {
      mockConstants.supportMailAddress = "support@example.com";
    }
  });
});
