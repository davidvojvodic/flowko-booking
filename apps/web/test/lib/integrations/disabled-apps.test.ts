import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "@calcom/web/pages/api/integrations/[...args]";

const { getServerSession, googleMeetAdd } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  googleMeetAdd: vi.fn(),
}));

vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession }));

vi.mock("@calcom/app-store/apps.server.generated", () => ({
  apiHandlers: { googlevideo: Promise.resolve({ add: googleMeetAdd }) },
}));

function callRoute(args: string[]) {
  const req = { method: "GET", query: { args } } as unknown as NextApiRequest;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    writableEnded: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      this.writableEnded = true;
      return this;
    },
  };
  return { res, done: handler(req, res as unknown as NextApiResponse) };
}

// Pages router routes are served from every file under pages/api, so this test lives in apps/web/test
describe("/api/integrations/[...args] with apps the admin switched off", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getServerSession.mockResolvedValue({ user: { id: 1 } });
    googleMeetAdd.mockReset();
  });

  it("refuses the routes of a disabled app", async () => {
    prismaMock.app.findUnique.mockResolvedValue({ enabled: false } as never);

    const { res, done } = callRoute(["googlevideo", "add"]);
    await done;

    expect(res.statusCode).toBe(403);
    expect(prismaMock.app.findUnique).toHaveBeenCalledWith({
      where: { dirName: "googlevideo" },
      select: { enabled: true },
    });
    expect(googleMeetAdd).not.toHaveBeenCalled();
  });

  it("refuses the routes of an app without an App row", async () => {
    prismaMock.app.findUnique.mockResolvedValue(null);

    const { res, done } = callRoute(["googlevideo", "add"]);
    await done;

    expect(res.statusCode).toBe(403);
    expect(googleMeetAdd).not.toHaveBeenCalled();
  });

  it("serves the routes of an enabled app", async () => {
    prismaMock.app.findUnique.mockResolvedValue({ enabled: true } as never);

    const { done } = callRoute(["googlevideo", "add"]);
    await done;

    expect(googleMeetAdd).toHaveBeenCalledTimes(1);
  });
});
