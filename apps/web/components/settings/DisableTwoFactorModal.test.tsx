import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Flowko U14: the password field of the Disable 2FA dialogs keeps the single border of PasswordField.

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("@calcom/features/components/controlled-dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@calcom/ui/components/dialog", () => ({
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@components/auth/BackupCode", () => ({ default: () => null }));
vi.mock("@components/auth/TwoFactor", () => ({ default: () => null }));

import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";

import SecurityModal from "../security/DisableTwoFactorModal";
import SettingsModal from "./DisableTwoFactorModal";

describe.each([
  ["settings", SettingsModal],
  ["security", SecurityModal],
])("Disable 2FA dialog (%s)", (_name, Modal) => {
  it("password input has no extra border class", () => {
    render(
      <TooltipProvider>
        <Modal open onOpenChange={() => {}} onCancel={() => {}} onDisable={() => {}} />
      </TooltipProvider>
    );
    const input = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.className.split(/\s+/)).not.toContain("border");
    expect(screen.queryByText("password")).toBeTruthy();
  });
});
