// Flowko U27: viewer.flowko.business.me. getBusinessAccess is mocked (it has its own tests); this pins the shape,
// the null for a non-member, hidesCalScreens and that no rate limit applies.
// Flowko U29a: me gains sharedDevice (S7; the pin below changes deliberately); the owner settings procedures
// (settings, updateSettings) and their strict input are pinned at the end of the file.
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getBusinessAccess: vi.fn(),
  listDeskServices: vi.fn(),
  listDeskMembers: vi.fn(),
  getBusinessSettings: vi.fn(),
  updateBusinessSettings: vi.fn(),
  checkRateLimitAndThrowError: vi.fn(),
  prisma: { flowkoBusiness: { findUnique: vi.fn() } },
}));

vi.mock("@calcom/prisma", () => ({ prisma: m.prisma, default: m.prisma }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({
  checkRateLimitAndThrowError: m.checkRateLimitAndThrowError,
}));
vi.mock("@calcom/features/flowkoBusiness/access", () => ({ getBusinessAccess: m.getBusinessAccess }));
vi.mock("@calcom/features/flowkoBusiness/desk", () => ({
  listDeskServices: m.listDeskServices,
  listDeskMembers: m.listDeskMembers,
}));
vi.mock("@calcom/features/flowkoBusiness/settings", () => ({
  getBusinessSettings: m.getBusinessSettings,
  updateBusinessSettings: m.updateBusinessSettings,
}));

import { FlowkoBusinessError } from "@calcom/features/flowkoBusiness/errors";

import {
  membersHandler,
  meHandler,
  servicesHandler,
  settingsHandler,
  updateSettingsHandler,
} from "./business.handler";
import { ZUpdateSettingsInput } from "./business.schema";

const ctx = { user: { id: 7 } } as never;

describe("viewer.flowko.business.me (Flowko U27)", () => {
  beforeEach(() => {
    m.getBusinessAccess.mockReset();
    m.prisma.flowkoBusiness.findUnique.mockReset();
    m.checkRateLimitAndThrowError.mockReset();
  });

  it("a non-member gets null and the business is not read", async () => {
    m.getBusinessAccess.mockResolvedValue(null);
    await expect(meHandler({ ctx })).resolves.toBeNull();
    expect(m.getBusinessAccess).toHaveBeenCalledWith(m.prisma, 7);
    expect(m.prisma.flowkoBusiness.findUnique).not.toHaveBeenCalled();
  });

  // Flowko U29a (S7): sharedDevice joined the result and the select (deliberate pin change).
  it("an owner gets the business, member, role and the shared-device switch; Cal screens stay visible", async () => {
    m.getBusinessAccess.mockResolvedValue({ businessId: 5, memberId: 11, userId: 7, role: "OWNER" });
    m.prisma.flowkoBusiness.findUnique.mockResolvedValue({
      name: "Salon Lila",
      slug: "salon-lila",
      sharedDevice: true,
    });
    await expect(meHandler({ ctx })).resolves.toEqual({
      businessId: 5,
      businessName: "Salon Lila",
      businessSlug: "salon-lila",
      memberId: 11,
      role: "OWNER",
      hidesCalScreens: false,
      sharedDevice: true,
    });
    expect(m.prisma.flowkoBusiness.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { name: true, slug: true, sharedDevice: true },
    });
  });

  it("sharedDevice is false when the switch is off (and when a row lacks it)", async () => {
    m.getBusinessAccess.mockResolvedValue({ businessId: 5, memberId: 12, userId: 7, role: "STAFF" });
    m.prisma.flowkoBusiness.findUnique.mockResolvedValue({ name: "Salon Lila", slug: "salon-lila", sharedDevice: false });
    expect(((await meHandler({ ctx })) as { sharedDevice: boolean }).sharedDevice).toBe(false);
    m.prisma.flowkoBusiness.findUnique.mockResolvedValue({ name: "Salon Lila", slug: "salon-lila" });
    expect(((await meHandler({ ctx })) as { sharedDevice: boolean }).sharedDevice).toBe(false);
  });

  it.each(["WORKER", "STAFF"])("a %s hides the Cal screens", async (role) => {
    m.getBusinessAccess.mockResolvedValue({ businessId: 5, memberId: 12, userId: 7, role });
    m.prisma.flowkoBusiness.findUnique.mockResolvedValue({ name: "Salon Lila", slug: "salon-lila" });
    const me = (await meHandler({ ctx })) as { role: string; hidesCalScreens: boolean };
    expect(me.role).toBe(role);
    expect(me.hidesCalScreens).toBe(true);
  });

  it("a business that vanished between the two reads gives null", async () => {
    m.getBusinessAccess.mockResolvedValue({ businessId: 5, memberId: 11, userId: 7, role: "OWNER" });
    m.prisma.flowkoBusiness.findUnique.mockResolvedValue(null);
    await expect(meHandler({ ctx })).resolves.toBeNull();
  });

  it("is not rate limited", async () => {
    m.getBusinessAccess.mockResolvedValue(null);
    await meHandler({ ctx });
    expect(m.checkRateLimitAndThrowError).not.toHaveBeenCalled();
  });

  it("maps a Flowko error through flowkoTrpcError and rethrows others unchanged", async () => {
    m.getBusinessAccess.mockRejectedValue(new FlowkoBusinessError("forbidden"));
    const err = await meHandler({ ctx }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
    const boom = new Error("db down");
    m.getBusinessAccess.mockRejectedValue(boom);
    await expect(meHandler({ ctx })).rejects.toBe(boom);
  });
});

// Flowko U28: desk reads, own rate-limit bucket.
describe.each([
  ["services", servicesHandler, m.listDeskServices],
  ["members", membersHandler, m.listDeskMembers],
] as const)("viewer.flowko.business.%s (Flowko U28)", (_name, handler, service) => {
  beforeEach(() => {
    service.mockReset();
    m.checkRateLimitAndThrowError.mockReset();
    m.checkRateLimitAndThrowError.mockResolvedValue({ success: true });
  });

  it("calls its service with the session user id, after the flowkoDesk:<id> limiter", async () => {
    service.mockResolvedValue("result");
    await expect(handler({ ctx })).resolves.toBe("result");
    expect(service).toHaveBeenCalledWith(m.prisma, 7);
    expect(m.checkRateLimitAndThrowError).toHaveBeenCalledWith({
      identifier: "flowkoDesk:7",
      rateLimitingType: "common",
    });
    expect(m.checkRateLimitAndThrowError.mock.invocationCallOrder[0]).toBeLessThan(
      service.mock.invocationCallOrder[0]
    );
  });

  it("a rate-limit refusal stops the call before the service runs", async () => {
    const limited = new Error("429");
    m.checkRateLimitAndThrowError.mockRejectedValue(limited);
    await expect(handler({ ctx })).rejects.toBe(limited);
    expect(service).not.toHaveBeenCalled();
  });

  it("maps forbidden to FORBIDDEN and rethrows others unchanged", async () => {
    service.mockRejectedValue(new FlowkoBusinessError("forbidden"));
    const err = await handler({ ctx }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
    const boom = new Error("db down");
    service.mockRejectedValue(boom);
    await expect(handler({ ctx })).rejects.toBe(boom);
  });
});

// Flowko U29a (S2, S14): the owner's settings. The service checks the owner and the rules (mocked here); this pins
// the actor (ctx.user.id), `now`, the flowkoSettings:<id> bucket before the service, needs_confirm as data and the
// error mapping (settings_changed / bad_profile → BAD_REQUEST with the code, forbidden → FORBIDDEN).
const UPDATED_AT = new Date("2026-11-16T07:00:00.000Z");
const openingHours = {
  mon: [{ from: "08:00", to: "20:00" }],
  tue: [{ from: "08:00", to: "20:00" }],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};
const settingsInput = {
  name: "Salon Lila",
  phone: "040 123 456",
  address: "Glavna 1, Ljubljana",
  email: "salon@example.si",
  openingHours,
  slotGridMinutes: 15,
  holidaysClosed: true,
  reminderOffsets: [1440, 120],
  sharedDevice: false,
  expectedUpdatedAt: UPDATED_AT,
  confirm: false,
};

const settingsCases = [
  {
    name: "settings",
    service: m.getBusinessSettings,
    run: () => settingsHandler({ ctx }),
    args: [m.prisma, 7],
  },
  {
    name: "updateSettings",
    service: m.updateBusinessSettings,
    run: () => updateSettingsHandler({ ctx, input: settingsInput }),
    args: [m.prisma, 7, settingsInput, expect.any(Date)],
  },
];

describe("viewer.flowko.business settings procedures (Flowko U29a)", () => {
  beforeEach(() => {
    m.getBusinessSettings.mockReset();
    m.updateBusinessSettings.mockReset();
    m.checkRateLimitAndThrowError.mockReset();
    m.checkRateLimitAndThrowError.mockResolvedValue({ success: true });
  });

  it.each(settingsCases)("$name calls its service with the session user id", async (c) => {
    c.service.mockResolvedValue("result");
    await expect(c.run()).resolves.toBe("result");
    expect(c.service).toHaveBeenCalledTimes(1);
    expect(c.service.mock.calls[0]).toEqual(c.args);
  });

  it.each(settingsCases)("$name rate limits as flowkoSettings:<id>, before the service", async (c) => {
    c.service.mockResolvedValue(undefined);
    await c.run();
    expect(m.checkRateLimitAndThrowError).toHaveBeenCalledTimes(1);
    expect(m.checkRateLimitAndThrowError).toHaveBeenCalledWith({
      identifier: "flowkoSettings:7",
      rateLimitingType: "common",
    });
    expect(m.checkRateLimitAndThrowError.mock.invocationCallOrder[0]).toBeLessThan(
      c.service.mock.invocationCallOrder[0]
    );
  });

  it.each(settingsCases)("$name: a rate-limit refusal stops it before the service runs", async (c) => {
    const limited = new Error("429");
    m.checkRateLimitAndThrowError.mockRejectedValue(limited);
    await expect(c.run()).rejects.toBe(limited);
    expect(c.service).not.toHaveBeenCalled();
  });

  it.each(settingsCases)("$name maps forbidden (not the owner) to FORBIDDEN", async (c) => {
    c.service.mockRejectedValue(new FlowkoBusinessError("forbidden"));
    const err = await c.run().catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
  });

  it.each(settingsCases)("$name rethrows a non-Flowko error unchanged", async (c) => {
    const boom = new Error("db down");
    c.service.mockRejectedValue(boom);
    await expect(c.run()).rejects.toBe(boom);
  });

  it.each(["settings_changed", "bad_profile"] as const)(
    "updateSettings maps %s to BAD_REQUEST with the code as message",
    async (code) => {
      m.updateBusinessSettings.mockRejectedValue(new FlowkoBusinessError(code));
      const err = await updateSettingsHandler({ ctx, input: settingsInput }).catch((e) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toBe(code);
    }
  );

  it("updateSettings returns needs_confirm as data, not as an error", async () => {
    const answer = { status: "needs_confirm", outside: { shifts: 2, bookings: 1 } };
    m.updateBusinessSettings.mockResolvedValue(answer);
    await expect(updateSettingsHandler({ ctx, input: settingsInput })).resolves.toEqual(answer);
  });
});

describe("ZUpdateSettingsInput (Flowko U29a, strict)", () => {
  const parse = (value: unknown) => ZUpdateSettingsInput.safeParse(value);

  it("accepts the form's values; confirm defaults to false", () => {
    expect(parse(settingsInput).success).toBe(true);
    const { confirm: _confirm, ...withoutConfirm } = settingsInput;
    const parsed = parse(withoutConfirm);
    expect(parsed.success && parsed.data.confirm).toBe(false);
  });

  it("refuses an unknown key (slug and time zone are not editable)", () => {
    expect(parse({ ...settingsInput, slug: "drug-salon" }).success).toBe(false);
    expect(parse({ ...settingsInput, timeZone: "UTC" }).success).toBe(false);
    expect(parse({ ...settingsInput, openingHours: { ...openingHours, hol: [] } }).success).toBe(false);
    expect(
      parse({ ...settingsInput, openingHours: { ...openingHours, mon: [{ from: "08:00", to: "20:00", x: 1 }] } })
        .success
    ).toBe(false);
  });

  it("refuses a missing field", () => {
    for (const key of Object.keys(settingsInput).filter((k) => k !== "confirm")) {
      const { [key]: _gone, ...rest } = settingsInput as Record<string, unknown>;
      expect(parse(rest).success, key).toBe(false);
    }
  });

  it("reminderOffsets must be one of REMINDER_CHOICES", () => {
    for (const offsets of [[], [1440], [120], [1440, 120]]) {
      expect(parse({ ...settingsInput, reminderOffsets: offsets }).success).toBe(true);
    }
    for (const offsets of [[60], [120, 1440], [1440, 1440], [1440, 120, 60], ["1440"]]) {
      expect(parse({ ...settingsInput, reminderOffsets: offsets }).success).toBe(false);
    }
  });

  it("expectedUpdatedAt is a real Date (superjson delivers one); booleans are booleans", () => {
    expect(parse({ ...settingsInput, expectedUpdatedAt: UPDATED_AT.toISOString() }).success).toBe(false);
    expect(parse({ ...settingsInput, expectedUpdatedAt: new Date("x") }).success).toBe(false);
    expect(parse({ ...settingsInput, sharedDevice: "true" }).success).toBe(false);
    expect(parse({ ...settingsInput, holidaysClosed: 1 }).success).toBe(false);
    expect(parse({ ...settingsInput, confirm: "yes" }).success).toBe(false);
  });

  it("address and e-mail may be null; phone and name may not", () => {
    expect(parse({ ...settingsInput, address: null, email: null }).success).toBe(true);
    expect(parse({ ...settingsInput, phone: null }).success).toBe(false);
    expect(parse({ ...settingsInput, name: null }).success).toBe(false);
  });

  it("an oversized text is refused early; the field rules themselves are the service's (bad_profile)", () => {
    expect(parse({ ...settingsInput, name: "n".repeat(501) }).success).toBe(false);
    expect(parse({ ...settingsInput, email: "e".repeat(501) }).success).toBe(false);
    // 81 characters breaks the name rule, but that answer is the service's bad_profile, not a zod message.
    expect(parse({ ...settingsInput, name: "n".repeat(81) }).success).toBe(true);
    expect(parse({ ...settingsInput, slotGridMinutes: 7 }).success).toBe(true);
    expect(parse({ ...settingsInput, slotGridMinutes: 7.5 }).success).toBe(false);
  });
});
