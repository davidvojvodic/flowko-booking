import { render } from "@testing-library/react";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { HttpError } from "@calcom/lib/http-error";
import { TimeFormat } from "@calcom/lib/timeFormat";

import { getError } from "./BookEventForm";

const t = ((key: string) => `t(${key})`) as unknown as TFunction;

const renderError = (dataError: unknown) => {
  const { container } = render(
    <div>
      {getError({
        globalError: undefined,
        dataError,
        t,
        responseVercelIdHeader: null,
        timeFormat: TimeFormat.TWENTY_FOUR_HOUR,
        timezone: "Europe/Ljubljana",
        language: "sl",
      })}
    </div>
  );
  return container.textContent?.trim();
};

describe("BookEventForm getError", () => {
  it("shows the rate-limit refusal in the booker's language, not the server's English text", () => {
    // What createBooking's fetch-wrapper throws for a 429 of /api/book/event: no status, the message kept
    const error = new HttpError({
      statusCode: undefined as unknown as number,
      message: "Rate limit exceeded. Try again in 42 seconds.",
    });

    expect(renderError(error)).toBe("t(rate_limit_exceeded)");
  });

  it("shows the rate-limit refusal for an HttpError 429", () => {
    const error = new HttpError({ statusCode: 429, message: "Rate limit exceeded. Try again in 1 seconds." });

    expect(renderError(error)).toBe("t(rate_limit_exceeded)");
  });

  it("keeps translating the server's error codes", () => {
    expect(renderError({ message: ErrorCode.NoAvailableUsersFound })).toBe(
      `t(${ErrorCode.NoAvailableUsersFound})`
    );
    expect(renderError({ message: ErrorCode.BookerLimitExceeded, data: { count: 2 } })).toBe(
      "t(booker_upcoming_limit_reached)"
    );
  });

  it("keeps the fallback when the error has no message", () => {
    expect(renderError({})).toBe("t(can_you_try_again)");
  });
});
