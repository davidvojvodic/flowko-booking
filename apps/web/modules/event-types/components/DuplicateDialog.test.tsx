import { render } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";

import { DuplicateDialog } from "./DuplicateDialog";

const mockShowToast = vi.fn();
vi.mock("@calcom/ui/components/toast", () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => `t(${key})` }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("@calcom/lib/hooks/useCompatSearchParams", () => ({
  useCompatSearchParams: () => new URLSearchParams(),
}));

vi.mock("@calcom/lib/hooks/useTypedQuery", () => ({
  useTypedQuery: () => ({
    data: { pageSlug: "owner", slug: "intro", title: "Intro", description: "", id: 1, length: 30 },
  }),
}));

vi.mock("@calcom/web/app/(use-page-wrapper)/(main-nav)/event-types/actions", () => ({
  revalidateEventTypesList: vi.fn(),
}));

vi.mock("@calcom/features/components/controlled-dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@calcom/ui/components/dialog", () => ({
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogClose: () => null,
}));

vi.mock("@calcom/ui/components/editor", () => ({
  Editor: () => null,
}));

let capturedOptions: { onError: (err: unknown) => void } | undefined;
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({}),
    viewer: {
      eventTypesHeavy: {
        duplicate: {
          useMutation: (options: { onError: (err: unknown) => void }) => {
            capturedOptions = options;
            return { mutate: vi.fn(), isPending: false };
          },
        },
      },
    },
  },
}));

const trpcError = (code: string, message: string) => ({ message, data: { code } });

describe("DuplicateDialog onError", () => {
  beforeEach(() => {
    mockShowToast.mockClear();
    capturedOptions = undefined;
    render(<DuplicateDialog />);
  });

  it("shows the disabled-app refusal instead of a generic error", () => {
    capturedOptions?.onError(trpcError("BAD_REQUEST", ErrorCode.AppNotAvailable));

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(`t(${ErrorCode.AppNotAvailable})`, "error");
  });

  it("shows the seats and recurring refusal instead of a generic error", () => {
    capturedOptions?.onError(trpcError("BAD_REQUEST", ErrorCode.SeatsAndRecurringNotAvailable));

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(`t(${ErrorCode.SeatsAndRecurringNotAvailable})`, "error");
  });

  it("keeps the generic message for any other bad request", () => {
    capturedOptions?.onError(trpcError("BAD_REQUEST", "something else"));

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith("t(unexpected_error_try_again)", "error");
  });

  it("keeps the slug conflict message", () => {
    capturedOptions?.onError(trpcError("CONFLICT", "duplicate_event_slug_conflict"));

    expect(mockShowToast).toHaveBeenCalledWith("t(duplicate_event_slug_conflict)", "error");
  });
});
