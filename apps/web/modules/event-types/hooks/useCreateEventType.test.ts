import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";

import { useCreateEventType } from "./useCreateEventType";

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => `t(${key})` }),
}));

vi.mock("@calcom/atoms/hooks/event-types/private/useCreateEventTypeForm", () => ({
  useCreateEventTypeForm: () => ({ form: { reset: vi.fn() }, isManagedEventType: false }),
}));

let capturedOptions: { onError: (err: unknown) => void } | undefined;
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({}),
    viewer: {
      eventTypesHeavy: {
        create: {
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

describe("useCreateEventType onError", () => {
  const onError = vi.fn();

  beforeEach(() => {
    onError.mockClear();
    capturedOptions = undefined;
    renderHook(() => useCreateEventType(vi.fn(), onError));
  });

  it("does not call a disabled-app refusal a duplicate URL", () => {
    capturedOptions?.onError(trpcError("BAD_REQUEST", ErrorCode.AppNotAvailable));

    expect(onError).toHaveBeenCalledWith(`t(${ErrorCode.AppNotAvailable})`);
  });

  it("does not call the seats and recurring refusal a duplicate URL", () => {
    capturedOptions?.onError(trpcError("BAD_REQUEST", ErrorCode.SeatsAndRecurringNotAvailable));

    expect(onError).toHaveBeenCalledWith(`t(${ErrorCode.SeatsAndRecurringNotAvailable})`);
  });

  it("keeps the duplicate URL message for the slug conflict", () => {
    capturedOptions?.onError(trpcError("BAD_REQUEST", "URL Slug already exists for given user."));

    expect(onError).toHaveBeenCalledWith("BAD_REQUEST: t(error_event_type_url_duplicate)");
  });

  it("keeps the unauthorized message", () => {
    capturedOptions?.onError(trpcError("UNAUTHORIZED", ""));

    expect(onError).toHaveBeenCalledWith("UNAUTHORIZED: t(error_event_type_unauthorized_create)");
  });
});
