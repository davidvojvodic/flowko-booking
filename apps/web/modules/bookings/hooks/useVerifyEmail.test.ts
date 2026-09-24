import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useVerifyEmail } from "./useVerifyEmail";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      public: { checkIfUserEmailVerificationRequired: { useQuery: mocks.useQuery } },
      auth: { sendVerifyEmailCode: { useMutation: mocks.useMutation } },
    },
  },
}));

vi.mock("next-auth/react", () => ({ useSession: mocks.useSession }));

vi.mock("@calcom/features/bookings/Booker/store", () => ({
  useBookerStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ verifiedEmail: null, setVerifiedEmail: vi.fn(), rescheduleUid: null, bookingData: null }),
}));

vi.mock("@calcom/lib/hooks/useDebounce", () => ({ useDebounce: (value: string) => value }));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("@calcom/ui/components/toast", () => ({ showToast: vi.fn() }));

describe("useVerifyEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useQuery.mockReturnValue({ data: false });
    mocks.useMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useSession.mockReturnValue({ data: { user: { email: "booker@example.com" } } });
  });

  // The server reads the signed-in booker's email from the session and no longer accepts it as input
  it("asks whether the typed email needs verification with only the email", () => {
    renderHook(() => useVerifyEmail({ email: "info@salon.si" }));

    expect(mocks.useQuery).toHaveBeenCalledWith({ email: "info@salon.si" }, expect.anything());
  });
});
