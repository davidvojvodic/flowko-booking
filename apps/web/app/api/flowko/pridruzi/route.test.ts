// Flowko U29d (Task 8, A2): POST /api/flowko/pridruzi, the public accept of an invite. Order: strict zod body →
// CSRF → per-IP limit → no session → token shape (no DB) → per-token limit → password rules → acceptInvite. The
// answer is `{}` (201) or `{ code }`; it never echoes the input, the e-mail or the token, and an unexpected error
// becomes 500 `server_error` with one log line (error name + Prisma code only), never the message.
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { FlowkoBusinessError } from "@calcom/features/flowkoBusiness/errors";
import { acceptInvite } from "@calcom/features/flowkoBusiness/inviteAccept";
import { hashInviteToken } from "@calcom/features/flowkoBusiness/inviteToken";
import { hashPassword } from "@calcom/lib/auth/hashPassword";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { HttpError } from "@calcom/lib/http-error";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import { Prisma } from "@calcom/prisma/client";
import { validateCsrfToken } from "@calcom/web/lib/validateCsrfToken";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const logs = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));

vi.mock("app/api/defaultResponderForAppDir", () => ({
  defaultResponderForAppDir:
    (handler: (req: NextRequest) => Promise<Response>) =>
    (req: NextRequest, _context: { params: Promise<Record<string, string>> }) =>
      handler(req),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body })),
  },
}));
vi.mock("@calcom/prisma", () => ({ default: { tag: "global-prisma" }, prisma: { tag: "global-prisma" } }));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: vi.fn() }));
vi.mock("@calcom/features/flowkoBusiness/inviteAccept", () => ({ acceptInvite: vi.fn() }));
vi.mock("@calcom/lib/auth/hashPassword", () => ({ hashPassword: vi.fn() }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: vi.fn() }));
vi.mock("@calcom/web/lib/validateCsrfToken", () => ({ validateCsrfToken: vi.fn() }));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyRequest: vi.fn(() => ({ tag: "legacy-request" })) }));
vi.mock("@calcom/lib/logger", () => ({ default: { getSubLogger: () => logs } }));

const mockSession = vi.mocked(getServerSession);
const mockAccept = vi.mocked(acceptInvite);
const mockRateLimit = vi.mocked(checkRateLimitAndThrowError);
const mockCsrf = vi.mocked(validateCsrfToken);

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"; // 43 base64url characters
const EMAIL = "hana@example.si";
const PASSWORD = "Geslo123";
const CSRF = "c".repeat(64);
const IP = "203.0.113.9";
const IP_KEY = `flowkoInviteAccept:${piiHasher.hash(IP)}`;
const TOKEN_KEY = `flowkoInviteToken:${hashInviteToken(TOKEN).slice(0, 16)}`;

type Answer = { status: number; body: Record<string, unknown> };

async function post(body: unknown, raw?: string): Promise<Answer> {
  const request = new Request("https://booking.example.com/api/flowko/pridruzi", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": IP },
    body: raw ?? JSON.stringify(body),
  }) as unknown as NextRequest;
  return (await POST(request, { params: Promise.resolve({}) })) as unknown as Answer;
}

const valid = (extra: Record<string, unknown> = {}) => ({
  token: TOKEN,
  name: "Hana",
  password: PASSWORD,
  csrfToken: CSRF,
  ...extra,
});

const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

describe("POST /api/flowko/pridruzi (Flowko U29d A2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(null);
    mockCsrf.mockResolvedValue(null);
    mockRateLimit.mockResolvedValue(undefined as never);
    mockAccept.mockResolvedValue({ status: "accepted", email: EMAIL });
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
    }
  });
  afterEach(() => {
    for (const spy of consoleSpies.splice(0)) spy.mockRestore();
  });

  it("accepts: 201 with an empty body; the service gets the global prisma, bcrypt and one Date", async () => {
    const answer = await post(valid());

    expect(answer).toEqual({ status: 201, body: {} });
    expect(mockAccept).toHaveBeenCalledTimes(1);
    const [deps, input, now] = mockAccept.mock.calls[0];
    expect(deps).toEqual({ db: { tag: "global-prisma" }, hashPassword });
    expect(input).toEqual({ token: TOKEN, name: "Hana", password: PASSWORD });
    expect(now).toBeInstanceOf(Date);
  });

  it("runs zod → CSRF → IP limit → session → token shape → token limit → password → service, in that order", async () => {
    await post(valid());

    expect(mockCsrf).toHaveBeenCalledWith(CSRF);
    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    expect(mockRateLimit.mock.calls[0][0]).toEqual({ rateLimitingType: "core", identifier: IP_KEY });
    expect(mockRateLimit.mock.calls[1][0]).toEqual({ rateLimitingType: "core", identifier: TOKEN_KEY });
    const csrf = mockCsrf.mock.invocationCallOrder[0];
    const ipLimit = mockRateLimit.mock.invocationCallOrder[0];
    const session = mockSession.mock.invocationCallOrder[0];
    const tokenLimit = mockRateLimit.mock.invocationCallOrder[1];
    const service = mockAccept.mock.invocationCallOrder[0];
    expect(csrf).toBeLessThan(ipLimit);
    expect(ipLimit).toBeLessThan(session);
    expect(session).toBeLessThan(tokenLimit);
    expect(tokenLimit).toBeLessThan(service);
  });

  it("the per-token key is the first 16 hex characters of the token's sha256, never the token", () => {
    expect(TOKEN_KEY).toMatch(/^flowkoInviteToken:[0-9a-f]{16}$/);
    expect(TOKEN_KEY).not.toContain(TOKEN);
  });

  it.each([
    ["an extra key", valid({ email: EMAIL })],
    ["no csrfToken", { token: TOKEN, name: "Hana", password: PASSWORD }],
    ["a token over 64 characters", valid({ token: "a".repeat(65) })],
    ["a name over 200 characters", valid({ name: "a".repeat(201) })],
    ["a password over 200 characters", valid({ password: `Aa1${"a".repeat(198)}` })],
    ["a number for the name", valid({ name: 5 })],
    ["an array body", [valid()]],
  ])("refuses %s with 400 bad_request before CSRF", async (_label, body) => {
    expect(await post(body)).toEqual({ status: 400, body: { code: "bad_request" } });
    expect(mockCsrf).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON with 400 bad_request and logs nothing", async () => {
    expect(await post(undefined, `{"password":"${PASSWORD}"`)).toEqual({
      status: 400,
      body: { code: "bad_request" },
    });
    expect(mockCsrf).not.toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    expect(logs.error).not.toHaveBeenCalled();
  });

  it("a missing or mismatched CSRF token answers the helper's 403 and nothing else runs", async () => {
    const refused = { status: 403, body: { success: false, message: "Invalid CSRF token" } };
    mockCsrf.mockResolvedValue(refused as never);

    expect(await post(valid())).toBe(refused);
    expect(await post(valid({ csrfToken: "" }))).toBe(refused);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("a signed-in visitor gets 409 signed_in (never an accept over another account)", async () => {
    mockSession.mockResolvedValue({ user: { id: 7 } } as Awaited<ReturnType<typeof getServerSession>>);

    expect(await post(valid())).toEqual({ status: 409, body: { code: "signed_in" } });
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it.each(["", "short", `${TOKEN}x`, `${TOKEN.slice(0, 42)}+`, `${TOKEN.slice(0, 42)}/`])(
    "a malformed token %j answers 400 invite_invalid without a DB call or the token limit",
    async (token) => {
      expect(await post(valid({ token }))).toEqual({ status: 400, body: { code: "invite_invalid" } });
      expect(mockRateLimit).toHaveBeenCalledTimes(1);
      expect(mockAccept).not.toHaveBeenCalled();
    }
  );

  it.each(["abc", "geslo123", "GESLO123", "Geslobrez", "Ab1"])(
    "a weak password %j answers 400 password_requirements_error",
    async (password) => {
      expect(await post(valid({ password }))).toEqual({
        status: 400,
        body: { code: "password_requirements_error" },
      });
      expect(mockAccept).not.toHaveBeenCalled();
    }
  );

  it("a password of 73 UTF-8 bytes that passes the rules answers 400 password_too_long", async () => {
    const password = `Aa1${"ž".repeat(35)}`;
    expect(Buffer.byteLength(password, "utf8")).toBe(73);

    expect(await post(valid({ password }))).toEqual({ status: 400, body: { code: "password_too_long" } });
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("a password of 71 UTF-8 bytes reaches the service", async () => {
    const password = `Aa1${"ž".repeat(34)}`;
    expect(Buffer.byteLength(password, "utf8")).toBe(71);

    expect(await post(valid({ password }))).toEqual({ status: 201, body: {} });
    expect(mockAccept.mock.calls[0][1].password).toBe(password);
  });

  it("checks the rules before the length: 37 × „ž“ (74 bytes, no capital, no digit) is password_requirements_error", async () => {
    expect(await post(valid({ password: "ž".repeat(37) }))).toEqual({
      status: 400,
      body: { code: "password_requirements_error" },
    });
  });

  it.each(["invite_invalid", "email_has_login", "member_name_taken", "bad_member"] as const)(
    "a service refusal %s answers 400 { code }",
    async (code) => {
      mockAccept.mockRejectedValue(new FlowkoBusinessError(code));
      expect(await post(valid())).toEqual({ status: 400, body: { code } });
    }
  );

  it("member_conflict (a lost lock race) answers 409 so the page can say „try again“", async () => {
    mockAccept.mockRejectedValue(new FlowkoBusinessError("member_conflict"));
    expect(await post(valid())).toEqual({ status: 409, body: { code: "member_conflict" } });
  });

  it("an unexpected error is 500 server_error; the body and every log carry no e-mail, token or hash", async () => {
    mockAccept.mockRejectedValue(
      new Prisma.PrismaClientValidationError(
        `Invalid value for email "${EMAIL}" token ${TOKEN} hash $2a$12$abcdefghijk`,
        { clientVersion: "6.16.1" }
      )
    );

    const answer = await post(valid());

    expect(answer).toEqual({ status: 500, body: { code: "server_error" } });
    expect(logs.error).toHaveBeenCalledTimes(1);
    expect(logs.error).toHaveBeenCalledWith("flowko_invite_accept_failed", {
      error: "PrismaClientValidationError",
      code: null,
    });
    const logged = JSON.stringify([
      ...Object.values(logs).flatMap((fn) => fn.mock.calls),
      ...consoleSpies.flatMap((spy) => spy.mock.calls),
    ]);
    for (const secret of [EMAIL, TOKEN, "$2", PASSWORD]) {
      expect(logged).not.toContain(secret);
      expect(JSON.stringify(answer)).not.toContain(secret);
    }
  });

  it("logs a Prisma error code (and only the code) for a known request error", async () => {
    mockAccept.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(`Unique failed on ${EMAIL}`, {
        code: "P2003",
        clientVersion: "6.16.1",
        meta: { email: EMAIL },
      })
    );

    expect(await post(valid())).toEqual({ status: 500, body: { code: "server_error" } });
    expect(logs.error).toHaveBeenCalledWith("flowko_invite_accept_failed", {
      error: "PrismaClientKnownRequestError",
      code: "P2003",
    });
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain(EMAIL);
  });

  it("a thrown non-Error value is 500 server_error too", async () => {
    mockAccept.mockRejectedValue(EMAIL);

    expect(await post(valid())).toEqual({ status: 500, body: { code: "server_error" } });
    expect(logs.error).toHaveBeenCalledWith("flowko_invite_accept_failed", { error: "unknown", code: null });
  });

  it("no answer carries the e-mail, the token, the name or the password", async () => {
    const answers: Answer[] = [await post(valid())];
    for (const code of [
      "invite_invalid",
      "email_has_login",
      "member_name_taken",
      "member_conflict",
    ] as const) {
      mockAccept.mockRejectedValueOnce(new FlowkoBusinessError(code));
      answers.push(await post(valid()));
    }
    answers.push(await post(valid({ password: "abc" })));
    answers.push(await post(valid({ token: "x" })));
    const text = JSON.stringify(answers);
    for (const secret of [EMAIL, TOKEN, "Hana", PASSWORD]) expect(text).not.toContain(secret);
  });

  it.each([0, 1])("a 429 from limiter %i passes through (the responder answers it)", async (which) => {
    const limited = new HttpError({
      statusCode: 429,
      message: "Rate limit exceeded. Try again in 9 seconds.",
    });
    if (which === 0) mockRateLimit.mockRejectedValueOnce(limited);
    else mockRateLimit.mockResolvedValueOnce(undefined as never).mockRejectedValueOnce(limited);

    await expect(post(valid())).rejects.toBe(limited);
    expect(mockAccept).not.toHaveBeenCalled();
    expect(logs.error).not.toHaveBeenCalled();
  });

  it("another HttpError (not 429) is a 500 server_error, not passed through", async () => {
    mockAccept.mockRejectedValue(new HttpError({ statusCode: 404, message: `no ${EMAIL}` }));

    expect(await post(valid())).toEqual({ status: 500, body: { code: "server_error" } });
  });
});
