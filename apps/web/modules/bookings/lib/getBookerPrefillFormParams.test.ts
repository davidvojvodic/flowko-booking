/**
 * @vitest-environment jsdom
 */
import { useInitialFormValues } from "@calcom/features/bookings/Booker/hooks/useInitialFormValues";
import type { BookerEvent } from "@calcom/features/bookings/types";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getBookerPrefillFormParams, isEmbedFrame } from "./getBookerPrefillFormParams";

vi.mock("@calcom/features/bookings/Booker/store", () => ({
  useBookerStore: vi.fn((selector) => selector({ bookingData: null, formValues: {} })),
}));

vi.mock("@calcom/features/bookings/lib/getBookingResponsesSchema", () => ({
  getBookingResponsesPartialSchema: vi.fn(() => ({
    parseAsync: vi.fn((data) => Promise.resolve(data)),
  })),
}));

const QUERY = "name=Ana+Novak&email=ana%40example.com&guests=spy%40example.com&guests=second%40example.com";

describe("getBookerPrefillFormParams", () => {
  it("prefills the name and the guests on the booking page", () => {
    expect(getBookerPrefillFormParams(new URLSearchParams(QUERY), { isEmbed: false })).toEqual({
      name: "Ana Novak",
      guests: ["spy@example.com", "second@example.com"],
    });
  });

  it("prefills the name but never the guests inside an embed", () => {
    expect(getBookerPrefillFormParams(new URLSearchParams(QUERY), { isEmbed: true })).toEqual({
      name: "Ana Novak",
      guests: [],
    });
    expect(
      getBookerPrefillFormParams(new URLSearchParams("guest=spy%40example.com"), { isEmbed: true }).guests
    ).toEqual([]);
  });

  it("builds the name from firstName and lastName as before", () => {
    expect(
      getBookerPrefillFormParams(new URLSearchParams("firstName=Ana&lastName=Novak"), { isEmbed: true })
    ).toEqual({ name: "Ana Novak", guests: [] });
    expect(getBookerPrefillFormParams(null, { isEmbed: false })).toEqual({ name: null, guests: [] });
  });
});

describe("isEmbedFrame", () => {
  afterEach(() => {
    delete window.isEmbed;
  });

  it("follows window.isEmbed, which embed-iframe-init sets before the first render", () => {
    expect(isEmbedFrame()).toBe(false);
    window.isEmbed = () => true;
    expect(isEmbedFrame()).toBe(true);
    window.isEmbed = () => false;
    expect(isEmbedFrame()).toBe(false);
  });
});

describe("the booking form's initial values inside an embed", () => {
  afterEach(() => {
    cleanup();
  });

  const eventType = {
    bookingFields: [
      { name: "name", type: "name", required: true },
      { name: "email", type: "email", required: true },
      { name: "guests", type: "multiemail", required: false },
    ],
    team: null,
    owner: null,
  } as unknown as Pick<BookerEvent, "bookingFields" | "team" | "owner">;

  function renderInitialValues(isEmbed: boolean) {
    const searchParams = new URLSearchParams(QUERY);
    // The booker passes the whole query as extraOptions, guests included (useRouterQuery)
    const extraOptions = { name: "Ana Novak", email: "ana@example.com", guests: ["spy@example.com"] };
    return renderHook(() =>
      useInitialFormValues({
        eventType,
        rescheduleUid: null,
        isRescheduling: false,
        email: null,
        name: null,
        username: null,
        hasSession: false,
        extraOptions,
        prefillFormParams: getBookerPrefillFormParams(searchParams, { isEmbed }),
      })
    );
  }

  it("has no guest from the query, even though extraOptions carries one", async () => {
    const { result } = renderInitialValues(true);

    await waitFor(() => expect(result.current.values.responses).toBeDefined());
    expect(result.current.values.responses?.guests).toEqual([]);
    expect(result.current.values.responses?.email).toBe("ana@example.com");
  });

  it("keeps the guests from the query on the booking page itself", async () => {
    const { result } = renderInitialValues(false);

    await waitFor(() => expect(result.current.values.responses).toBeDefined());
    expect(result.current.values.responses?.guests).toEqual(["spy@example.com", "second@example.com"]);
  });
});
