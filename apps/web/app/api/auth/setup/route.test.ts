import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({
  default: { user: { count: mocks.count, create: mocks.create } },
  prisma: { user: { count: mocks.count, create: mocks.create } },
}));
vi.mock("@calcom/lib/auth/hashPassword", () => ({ hashPassword: vi.fn().mockResolvedValue("hashed") }));

import { POST } from "./route";

// Flowko (U13 hardening): the first-run setup, which creates the first admin, refuses a reserved username
// too (reservedUsernames.ts). It only runs on an instance without users.

const body = (username: string) => ({
  username,
  full_name: "Flowko Admin",
  email_address: "admin@example.com",
  password: "Unit-test-only-Passw0rd",
});

async function post(username: string) {
  const req = new NextRequest("https://booking.example.com/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body(username)),
  });
  return POST(req, { params: Promise.resolve({}) });
}

describe("POST /api/auth/setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(0);
    mocks.create.mockResolvedValue({ id: 1 });
  });

  it.each([
    "embed",
    "Settings",
    "booking",
    "sl",
    "studio embed",
  ])("refuses the username %j", async (username) => {
    const res = await post(username);
    expect(res.status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates the admin with an unreserved username", async () => {
    const res = await post("Flowko Admin");
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ username: "flowko-admin" }) })
    );
  });
});
