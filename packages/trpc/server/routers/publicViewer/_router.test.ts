import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCallerFactory } from "../../trpc";
import { publicViewerRouter } from "./_router";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  emailVerificationHandler: vi.fn(),
  noShowHandler: vi.fn(),
}));

vi.mock("@calcom/features/auth/lib/userFromSessionUtils", () => ({ getSession: mocks.getSession }));
vi.mock("./checkIfUserEmailVerificationRequired.handler", () => ({ default: mocks.emailVerificationHandler }));
vi.mock("./markHostAsNoShow.handler", () => ({ default: mocks.noShowHandler }));

const createCaller = createCallerFactory(publicViewerRouter);

const req = { headers: { "x-forwarded-for": "203.0.113.1" } };

function caller() {
  return createCaller({ req } as unknown as Parameters<typeof createCaller>[0]);
}

describe("publicViewerRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.emailVerificationHandler.mockResolvedValue(true);
    mocks.noShowHandler.mockResolvedValue({ attendees: [], noShowHost: true, message: "ok" });
  });

  describe("checkIfUserEmailVerificationRequired", () => {
    // A caller could otherwise claim to be the user who owns the address and get `false` back
    it("takes the signed-in booker's email from the session, not from the input", async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 1, email: "booker@example.com" } });

      await caller().checkIfUserEmailVerificationRequired({
        email: "info@salon.si",
        userSessionEmail: "info@salon.si",
      } as never);

      expect(mocks.getSession).toHaveBeenCalledWith(expect.objectContaining({ req }));
      expect(mocks.emailVerificationHandler).toHaveBeenCalledWith({
        ctx: expect.objectContaining({ req }),
        input: { email: "info@salon.si" },
        userSessionEmail: "booker@example.com",
      });
    });

    it("passes no session email for an anonymous booker", async () => {
      mocks.getSession.mockResolvedValue(null);

      await expect(
        caller().checkIfUserEmailVerificationRequired({
          email: "info@salon.si",
          userSessionEmail: "info@salon.si",
        } as never)
      ).resolves.toBe(true);

      expect(mocks.emailVerificationHandler).toHaveBeenCalledWith({
        ctx: expect.objectContaining({ req }),
        input: { email: "info@salon.si" },
        userSessionEmail: undefined,
      });
    });
  });

  // The handler throttles per IP, so it needs the request
  it("hands markHostAsNoShow the request", async () => {
    await caller().markHostAsNoShow({ bookingUid: "uid-1", noShowHost: true });

    expect(mocks.noShowHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({ req }),
        input: { bookingUid: "uid-1", noShowHost: true },
      })
    );
  });
});
