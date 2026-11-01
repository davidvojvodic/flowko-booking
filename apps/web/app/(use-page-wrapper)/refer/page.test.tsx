import { describe, expect, it, vi } from "vitest";

// Flowko U14: the upstream referral page is gone; /refer sends everyone to the event types.

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import ReferralsPage, * as pageModule from "./page";

describe("/refer", () => {
  it("redirects to /event-types", async () => {
    await expect(Promise.resolve().then(() => ReferralsPage())).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/event-types");
  });

  it("carries no upstream metadata", () => {
    expect((pageModule as Record<string, unknown>).metadata).toBeUndefined();
    expect((pageModule as Record<string, unknown>).generateMetadata).toBeUndefined();
  });
});
