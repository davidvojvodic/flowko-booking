import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPiiFreeCredential, getPiiFreeEventResult } from "./piiFreeData";

describe("piiFreeData", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("getPiiFreeCredential keeps the ids and drops the key, the encrypted key and the host's email", () => {
    // Shaped like credentialForCalendarServiceSelect
    const credential = {
      id: 5,
      type: "google_calendar",
      appId: "google-calendar",
      userId: 101,
      teamId: null,
      invalid: false,
      delegationCredentialId: null,
      key: { refresh_token: "secret-refresh-token" },
      encryptedKey: "encrypted-key-ciphertext",
      user: { email: "salon.owner@gmail.com" },
      delegatedTo: null,
    };

    const logged = JSON.stringify(getPiiFreeCredential(credential));

    expect(JSON.parse(logged)).toMatchObject({ id: 5, type: "google_calendar", userId: 101 });
    expect(logged).not.toContain("secret-refresh-token");
    expect(logged).not.toContain("encrypted-key-ciphertext");
    expect(logged).not.toContain("salon.owner@gmail.com");
  });

  it("getPiiFreeEventResult says whether events came back without logging them", () => {
    // Shaped like an EventResult, with the whole CalendarEvent as originalEvent
    const result = {
      type: "google_calendar",
      appName: "Google Calendar",
      success: false,
      uid: "",
      credentialId: 5,
      createdEvent: { attendees: [{ email: "janez@example.si" }] },
      updatedEvent: undefined,
      externalId: "salon.owner@gmail.com",
      originalEvent: { title: "Striženje med Janez Novak in Salon" },
    };

    const logged = JSON.stringify(getPiiFreeEventResult(result));

    expect(JSON.parse(logged)).toMatchObject({
      credentialId: 5,
      hasCreatedEvent: true,
      hasUpdatedEvent: false,
      hasExternalId: true,
    });
    expect(logged).not.toContain("janez@example.si");
    expect(logged).not.toContain("salon.owner@gmail.com");
    expect(logged).not.toContain("Janez Novak");
  });
});
