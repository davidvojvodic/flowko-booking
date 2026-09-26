import { Prisma } from "@calcom/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { getRequestedSlugError } from "./team-billing";

// Flowko: the taken-slug message named help@cal.com. It now names SUPPORT_MAIL_ADDRESS (U12).
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  SUPPORT_MAIL_ADDRESS: "support@example.com",
}));

describe("getRequestedSlugError", () => {
  it("names SUPPORT_MAIL_ADDRESS when another team took the requested slug", () => {
    const uniqueConstraintFailed = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });

    expect(getRequestedSlugError(uniqueConstraintFailed, "acme")).toEqual({
      statusCode: 400,
      message:
        "It seems like the requestedSlug: 'acme' is already taken. Please contact support at support@example.com so we can resolve this issue.",
    });
  });

  it("passes any other error's message through", () => {
    expect(getRequestedSlugError(new Error("boom"), "acme")).toEqual({ statusCode: 500, message: "boom" });
  });
});
