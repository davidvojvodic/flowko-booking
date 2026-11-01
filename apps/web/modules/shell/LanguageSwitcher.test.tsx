import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageSwitcher } from "./LanguageSwitcher";

const mocks = vi.hoisted(() => ({
  language: "sl",
  mutate: vi.fn(),
  options: {} as { onSuccess?: (data: { locale: string }) => Promise<void>; onError?: () => void },
  update: vi.fn(),
  refresh: vi.fn(),
  showToast: vi.fn(),
  isPending: false,
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: mocks.language } }),
}));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      me: {
        setUiLanguage: {
          useMutation: (options: typeof mocks.options) => {
            mocks.options = options;
            return { mutate: mocks.mutate, isPending: mocks.isPending };
          },
        },
      },
    },
  },
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ update: mocks.update }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: mocks.showToast }));

describe("LanguageSwitcher (Flowko U14)", () => {
  beforeEach(() => {
    mocks.language = "sl";
    mocks.isPending = false;
    mocks.mutate.mockReset();
    mocks.refresh.mockReset();
    mocks.showToast.mockReset();
    mocks.update.mockReset();
    mocks.update.mockResolvedValue(undefined);
    document.body.innerHTML = "";
  });

  afterEach(() => {
    delete (window as { calNewLocale?: string }).calNewLocale;
  });

  it("shows SL / EN with the active one pressed and each in its own language", () => {
    render(<LanguageSwitcher />);

    const sl = screen.getByRole("button", { name: "SL" });
    const en = screen.getByRole("button", { name: "EN" });
    expect(sl).toHaveAttribute("aria-pressed", "true");
    expect(en).toHaveAttribute("aria-pressed", "false");
    expect(sl).toHaveAttribute("lang", "sl");
    expect(en).toHaveAttribute("lang", "en");
    expect(screen.getByRole("group", { name: "language_switcher_label" })).toBeInTheDocument();
  });

  it("presses neither for a stored language the switch doesn't offer", () => {
    mocks.language = "de";
    render(<LanguageSwitcher />);

    expect(screen.getByRole("button", { name: "SL" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "false");
  });

  it("saves the choice, updates the session, then refreshes the page", async () => {
    render(<LanguageSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(mocks.mutate).toHaveBeenCalledWith({ language: "en" });
    expect(mocks.update).not.toHaveBeenCalled();

    await mocks.options.onSuccess?.({ locale: "en" });

    expect(mocks.update).toHaveBeenCalledWith({ locale: "en" });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.refresh.mock.invocationCallOrder[0]);
    expect((window as unknown as { calNewLocale: string }).calNewLocale).toBe("en");
  });

  it("writes no cookie and no storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<LanguageSwitcher />);

    await mocks.options.onSuccess?.({ locale: "en" });

    expect(document.cookie).toBe("");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("does nothing for the language already active", () => {
    render(<LanguageSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: "SL" }));

    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("can't be clicked twice while saving", () => {
    mocks.isPending = true;
    render(<LanguageSwitcher />);

    expect(screen.getByRole("button", { name: "EN" })).toBeDisabled();
  });

  it("says so when saving fails, and doesn't touch the session", () => {
    render(<LanguageSwitcher />);

    mocks.options.onError?.();

    expect(mocks.showToast).toHaveBeenCalledWith("error_updating_settings", "error");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
