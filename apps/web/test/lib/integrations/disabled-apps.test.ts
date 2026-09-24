import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "@calcom/web/pages/api/integrations/[...args]";

const {
  getServerSession,
  googleMeetAdd,
  googleCalendarCallback,
  intercomGet,
  jitsiAdd,
  facetimeCreateCredential,
} = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  googleMeetAdd: vi.fn(),
  googleCalendarCallback: vi.fn(),
  intercomGet: vi.fn(),
  jitsiAdd: vi.fn(),
  facetimeCreateCredential: vi.fn(),
}));

vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession }));

// Each app keeps its real dirName and handler shape: a function per endpoint, or a declarative add
vi.mock("@calcom/app-store/apps.server.generated", () => ({
  apiHandlers: {
    googlevideo: Promise.resolve({ add: googleMeetAdd }),
    googlecalendar: Promise.resolve({ callback: googleCalendarCallback }),
    intercom: Promise.resolve({ get: intercomGet }),
    jitsivideo: Promise.resolve({ add: jitsiAdd }),
    facetime: Promise.resolve({
      add: {
        appType: "facetime_video",
        variant: "conferencing",
        slug: "facetime",
        supportsMultipleInstalls: false,
        handlerType: "add",
        createCredential: facetimeCreateCredential,
      },
    }),
  },
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
    for (const mock of [googleMeetAdd, googleCalendarCallback, intercomGet, jitsiAdd, facetimeCreateCredential])
      mock.mockReset();
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

  // An OAuth callback installs the app too (it stores the tokens as a credential)
  it("refuses a disabled app's callback", async () => {
    prismaMock.app.findUnique.mockResolvedValue({ enabled: false } as never);

    const { res, done } = callRoute(["googlecalendar", "callback"]);
    await done;

    expect(res.statusCode).toBe(403);
    expect(prismaMock.app.findUnique).toHaveBeenCalledWith({
      where: { dirName: "googlecalendar" },
      select: { enabled: true },
    });
    expect(googleCalendarCallback).not.toHaveBeenCalled();
  });

  it("serves the callback once the admin enables the app", async () => {
    prismaMock.app.findUnique.mockResolvedValue({ enabled: true } as never);

    const { done } = callRoute(["googlecalendar", "callback"]);
    await done;

    expect(googleCalendarCallback).toHaveBeenCalledTimes(1);
  });

  // Only "add" requires a session in the dispatcher, so for the other endpoints the switch is the only gate
  it("refuses a disabled app's custom endpoint to an anonymous visitor", async () => {
    getServerSession.mockResolvedValue(null);
    prismaMock.app.findUnique.mockResolvedValue({ enabled: false } as never);

    const { res, done } = callRoute(["intercom", "get"]);
    await done;

    expect(res.statusCode).toBe(403);
    expect(prismaMock.app.findUnique).toHaveBeenCalledWith({
      where: { dirName: "intercom" },
      select: { enabled: true },
    });
    expect(intercomGet).not.toHaveBeenCalled();
  });

  // A declarative add is run by the dispatcher itself, which would create the credential
  it("refuses a disabled app's declarative add", async () => {
    prismaMock.app.findUnique.mockResolvedValue({ enabled: false } as never);

    const { res, done } = callRoute(["facetime", "add"]);
    await done;

    expect(res.statusCode).toBe(403);
    expect(prismaMock.app.findUnique).toHaveBeenCalledWith({
      where: { dirName: "facetime" },
      select: { enabled: true },
    });
    expect(prismaMock.credential.findFirst).not.toHaveBeenCalled();
    expect(facetimeCreateCredential).not.toHaveBeenCalled();
  });

  it("runs an enabled app's declarative add", async () => {
    prismaMock.app.findUnique.mockResolvedValue({ enabled: true } as never);
    prismaMock.credential.findFirst.mockResolvedValue(null);

    const { done } = callRoute(["facetime", "add"]);
    await done;

    expect(facetimeCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({ appType: "facetime_video", slug: "facetime", user: { id: 1 } })
    );
  });

  // Credentials and locations name an app by its type, which the dispatcher maps to the app's directory
  it("checks the app's directory when the route names its type", async () => {
    prismaMock.app.findUnique.mockResolvedValue({ enabled: false } as never);

    const { res, done } = callRoute(["jitsi_video", "add"]);
    await done;

    expect(res.statusCode).toBe(403);
    expect(prismaMock.app.findUnique).toHaveBeenCalledWith({
      where: { dirName: "jitsivideo" },
      select: { enabled: true },
    });
    expect(jitsiAdd).not.toHaveBeenCalled();
  });
});
