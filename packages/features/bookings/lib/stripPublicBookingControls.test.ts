import { describe, expect, it } from "vitest";

import { stripPublicBookingControls } from "./stripPublicBookingControls";

describe("stripPublicBookingControls", () => {
  it("drops the fields only trusted callers may set", () => {
    const body = {
      eventTypeId: 1,
      start: "2026-10-23T12:00:00.000Z",
      responses: { name: "Janez", email: "janez@example.com" },
      noEmail: true,
      appsStatus: [{ appName: "x", success: 1, failures: 0, type: "x", errors: [] }],
      luckyUsers: [1],
    };

    const publicBody = stripPublicBookingControls(body);

    expect(publicBody).not.toHaveProperty("noEmail");
    expect(publicBody).not.toHaveProperty("appsStatus");
    expect(publicBody).not.toHaveProperty("luckyUsers");
    expect(publicBody).toEqual({
      eventTypeId: 1,
      start: "2026-10-23T12:00:00.000Z",
      responses: { name: "Janez", email: "janez@example.com" },
    });
  });

  it("does not mutate the request body it is given", () => {
    const body = { eventTypeId: 1, noEmail: true };

    stripPublicBookingControls(body);

    expect(body).toEqual({ eventTypeId: 1, noEmail: true });
  });
});
