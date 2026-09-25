import prismock from "@calcom/testing/lib/__mocks__/prisma";

import { beforeEach, describe, expect, it } from "vitest";

import { FeaturesRepository } from "@calcom/features/flags/features.repository";
import { getTestEmails, resetTestEmails } from "@calcom/lib/testEmails";

import { invalidateCredential } from "./invalidateCredential";

const USER_ID = 1;
const CREDENTIAL_ID = 10;
const HOST_EMAIL = "frizerstvo@flowko.si";
const ACCESS_TOKEN = "ya29.secret-access-token";
const REFRESH_TOKEN = "1//secret-refresh-token";

const seedHost = async ({
  locale = "sl",
  type = "google_calendar",
  appId = "google-calendar",
  invalid = false,
  withSelectedCalendar = true,
}: {
  locale?: string;
  type?: string;
  appId?: string;
  invalid?: boolean;
  withSelectedCalendar?: boolean;
} = {}) => {
  await prismock.user.create({
    data: { id: USER_ID, email: HOST_EMAIL, username: "frizerstvo", name: "Frizerstvo Ana", locale },
  });
  await prismock.credential.create({
    data: {
      id: CREDENTIAL_ID,
      type,
      appId,
      userId: USER_ID,
      invalid,
      key: { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN },
    },
  });
  if (withSelectedCalendar) {
    await prismock.selectedCalendar.create({
      data: {
        id: "primary",
        userId: USER_ID,
        integration: type,
        externalId: "frizerstvo.ana@gmail.com",
        credentialId: CREDENTIAL_ID,
      },
    });
  }
};

const emails = () => getTestEmails() ?? [];
const isInvalid = async () =>
  (await prismock.credential.findUnique({ where: { id: CREDENTIAL_ID } }))?.invalid;

describe("invalidateCredential", () => {
  beforeEach(() => {
    resetTestEmails();
    // The "emails" kill switch is read through a five-minute static cache
    Reflect.set(FeaturesRepository, "featuresCache", null);
  });

  it("marks the credential invalid and tells the host once across repeated and concurrent failures", async () => {
    await seedHost();

    await Promise.all([invalidateCredential(CREDENTIAL_ID), invalidateCredential(CREDENTIAL_ID)]);
    await invalidateCredential(CREDENTIAL_ID);

    expect(await isInvalid()).toBe(true);
    expect(emails()).toHaveLength(1);
    expect(emails()[0].to).toBe(HOST_EMAIL);
  });

  it("writes to the host in Slovenian, with the reconnect link and nothing secret", async () => {
    await seedHost({ locale: "sl" });

    await invalidateCredential(CREDENTIAL_ID);

    const [email] = emails();
    expect(email.subject).toBe("Povezava z Google Calendar ne deluje");
    const { html, text } = email as typeof email & { text: string };
    for (const body of [html, text]) {
      expect(body).toContain("Pozdravljeni, Frizerstvo Ana,");
      expect(body).toContain(
        "Povezava z vašim koledarjem Google Calendar je prenehala delovati: dovoljenja so potekla ali bila preklicana."
      );
      expect(body).toContain(
        "Dokler koledarja znova ne povežete, vaša javna stran za rezervacije ne prikazuje prostih terminov"
      );
      expect(body).toContain("Aplikacije → Nameščene aplikacije → Koledarji");
      expect(body).toContain("/apps/installed/calendar");
      for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, "frizerstvo.ana@gmail.com"]) {
        expect(body).not.toContain(secret);
      }
    }
    expect(html).toContain("Znova poveži koledar");
  });

  it("writes to an English-speaking host in English", async () => {
    await seedHost({ locale: "en" });

    await invalidateCredential(CREDENTIAL_ID);

    const [email] = emails();
    expect(email.subject).toBe("The connection to Google Calendar is not working");
    expect(email.html).toContain("Until you reconnect it, your public booking page shows no free slots");
    expect(email.html).toContain("Reconnect calendar");
  });

  it("does not claim a blocked booking page when no calendar of the connection is checked", async () => {
    await seedHost({ withSelectedCalendar: false });

    await invalidateCredential(CREDENTIAL_ID);

    expect(emails()).toHaveLength(1);
    expect(emails()[0].html).not.toContain("ne prikazuje prostih terminov");
  });

  it("sends nothing for a credential that was already invalid", async () => {
    await seedHost({ invalid: true });

    await invalidateCredential(CREDENTIAL_ID);

    expect(await isInvalid()).toBe(true);
    expect(emails()).toHaveLength(0);
  });

  it("marks a non-calendar credential invalid without an e-mail", async () => {
    await seedHost({ type: "zoom_video", appId: "zoom", withSelectedCalendar: false });

    await invalidateCredential(CREDENTIAL_ID);

    expect(await isInvalid()).toBe(true);
    expect(emails()).toHaveLength(0);
  });

  it("honours the emails kill switch", async () => {
    await seedHost();
    await prismock.feature.create({ data: { slug: "emails", enabled: true } });

    await invalidateCredential(CREDENTIAL_ID);

    expect(await isInvalid()).toBe(true);
    expect(emails()).toHaveLength(0);
  });

  it("does nothing for a credential that no longer exists", async () => {
    await expect(invalidateCredential(CREDENTIAL_ID)).resolves.toBeUndefined();
    expect(emails()).toHaveLength(0);
  });
});
