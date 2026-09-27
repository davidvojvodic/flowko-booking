import { beforeEach, describe, expect, it, vi } from "vitest";

const { findEventType, findUser } = vi.hoisted(() => ({
  findEventType: vi.fn(),
  findUser: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({
  prisma: {
    eventType: { findUnique: findEventType },
    user: { findFirst: findUser },
  },
}));

import { getEventTypePageLocale, getUserPageLocale } from "./getBookerPageLocale";

describe("getEventTypePageLocale", () => {
  beforeEach(() => {
    findEventType.mockReset();
    findUser.mockReset();
  });

  it("uses the event type's interface language when it has one, without asking for the owner's", async () => {
    await expect(getEventTypePageLocale({ interfaceLanguage: "en", eventTypeId: 5 })).resolves.toBe("en");
    expect(findEventType).not.toHaveBeenCalled();
  });

  it("falls back to the owner's language when the event type has none", async () => {
    findEventType.mockResolvedValue({ owner: { locale: "sl" } });

    await expect(getEventTypePageLocale({ interfaceLanguage: null, eventTypeId: 5 })).resolves.toBe("sl");
    expect(findEventType).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { owner: { select: { locale: true } } },
    });
  });

  it("keeps the visitor's browser language for an explicit „Jezik brskalnika obiskovalca“ (\"\"), without asking for the owner's", async () => {
    findEventType.mockResolvedValue({ owner: { locale: "sl" } });

    await expect(getEventTypePageLocale({ interfaceLanguage: "", eventTypeId: 5 })).resolves.toBeNull();
    expect(findEventType).not.toHaveBeenCalled();
  });

  it("falls back to the owner's language when the interface language is undefined (not loaded)", async () => {
    findEventType.mockResolvedValue({ owner: { locale: "sl" } });

    await expect(getEventTypePageLocale({ eventTypeId: 5 })).resolves.toBe("sl");
  });

  it.each([
    ["an owner without a language", { owner: { locale: null } }],
    ["an owner whose language the app doesn't ship", { owner: { locale: "xx" } }],
    ["no owner (a team's event type)", { owner: null }],
    ["an event type that is gone", null],
  ])("keeps the root layout's language for %s", async (_kind, row) => {
    findEventType.mockResolvedValue(row);

    await expect(getEventTypePageLocale({ interfaceLanguage: null, eventTypeId: 5 })).resolves.toBeNull();
  });

  it("asks for nothing without an event type id (the dynamic event's id is 0)", async () => {
    await expect(getEventTypePageLocale({ interfaceLanguage: null, eventTypeId: 0 })).resolves.toBeNull();
    await expect(getEventTypePageLocale({})).resolves.toBeNull();
    expect(findEventType).not.toHaveBeenCalled();
  });
});

describe("getUserPageLocale", () => {
  beforeEach(() => {
    findUser.mockReset();
  });

  it("uses the user's own language", async () => {
    findUser.mockResolvedValue({ locale: "sl" });

    await expect(getUserPageLocale("salon")).resolves.toBe("sl");
    expect(findUser).toHaveBeenCalledWith({
      where: { username: "salon", organizationId: null },
      select: { locale: true },
    });
  });

  it("keeps the root layout's language without a supported language or a username", async () => {
    findUser.mockResolvedValue({ locale: null });
    await expect(getUserPageLocale("salon")).resolves.toBeNull();
    findUser.mockResolvedValue(null);
    await expect(getUserPageLocale("salon")).resolves.toBeNull();
    await expect(getUserPageLocale(null)).resolves.toBeNull();
  });
});
