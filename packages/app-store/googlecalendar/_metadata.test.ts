import fs from "node:fs";
import path from "node:path";

import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import { describe, expect, it } from "vitest";

import { metadata } from "./_metadata";

// Google's OAuth verification reviewer sees /apps/google-calendar, so it must present Flowko as the
// publisher and describe what the app does with the calendar, not Cal.diy's upstream copy.
const UPSTREAM_BRAND = /cal\.diy|cal\.com/i;

// The app page body: DESCRIPTION.md (English, for every locale without its own file) and DESCRIPTION.sl.md.
// Both say the same thing as the connect notice and privacy policy section 3.3.
const DESCRIPTION_BODY_EN =
  "Connect Google Calendar to Flowko Rezervacije. The app will read the list of your calendars and the times you are busy in the calendars you choose, so that customers cannot book appointments when you are busy. It adds every booking to the calendar you choose, updates it when it changes and deletes it when it is cancelled. It does not read the contents of your other events.\n" +
  "\n" +
  "You can disconnect at any time under Apps → Installed apps → Calendars or at https://myaccount.google.com/connections. See section 3.3 of the privacy policy: https://flowko.si/privacy\n";

const DESCRIPTION_BODY_SL =
  "Povežite Google Calendar z aplikacijo Flowko Rezervacije. Aplikacija bo brala seznam vaših koledarjev in čase, ko ste zasedeni v koledarjih, ki jih izberete, da stranke ne morejo rezervirati terminov, ko ste zasedeni. Vsako rezervacijo doda v koledar, ki ga izberete, jo ob spremembi posodobi in ob odpovedi izbriše. Vsebine drugih dogodkov ne bere.\n" +
  "\n" +
  "Povezavo lahko kadar koli prekinete v razdelku Aplikacije → Nameščene aplikacije → Koledarji ali na strani https://myaccount.google.com/connections. Več v razdelku 3.3 pravilnika o zasebnosti: https://flowko.si/privacy\n";

const readDescription = (file: string) => fs.readFileSync(path.join(__dirname, file), "utf8");

describe("Google Calendar app page", () => {
  it("names Flowko as the publisher and contact", () => {
    expect(metadata.publisher).toBe("Flowko");
    expect(metadata.url).toBe("https://flowko.si/");
    expect(metadata.email).toBe("rezervacije@flowko.si");
  });

  // The UI shows the short description through getAppDescription: the i18n key in English or Slovenian.
  it("describes the app in English, and in Slovenian through the i18n key", () => {
    expect(metadata.description).toBe(
      "Connect Google Calendar so that customers cannot book appointments when you are busy, and so that every booking is added to your calendar automatically, updated when it changes and deleted when it is cancelled."
    );
    expect(en.google_calendar_app_description).toBe(metadata.description);
    expect(sl.google_calendar_app_description).toBe(
      "Povežite Google Calendar, da stranke ne morejo rezervirati terminov, ko ste zasedeni, in da se vsaka rezervacija samodejno doda v vaš koledar, ob spremembi posodobi in ob odpovedi izbriše."
    );
  });

  it("keeps the app's identity", () => {
    expect(metadata).toMatchObject({
      name: "Google Calendar",
      title: "Google Calendar",
      slug: "google-calendar",
      type: "google_calendar",
      dirName: "googlecalendar",
      variant: "calendar",
      category: "calendar",
      categories: ["calendar"],
      logo: "icon.svg",
      isOAuth: true,
    });
  });

  it("does not mention Cal.diy or Cal.com in any metadata text", () => {
    const texts = Object.values(metadata).filter((value): value is string => typeof value === "string");
    expect(texts.filter((text) => UPSTREAM_BRAND.test(text))).toEqual([]);
  });

  // Flowko: the upstream front-matter listed GCal1.png and GCal2.png, screenshots of Cal.com's own
  // calendar (Cal.com events and real people's calendar names) that the app page showed as a gallery.
  // With no front-matter the page renders no gallery, so the page body is the whole file.
  it.each([
    ["DESCRIPTION.md", DESCRIPTION_BODY_EN],
    ["DESCRIPTION.sl.md", DESCRIPTION_BODY_SL],
  ])("shows no upstream screenshots and uses Flowko's description as the page body (%s)", (file, body) => {
    const description = readDescription(file);
    expect(description).toBe(body);
    expect(description).not.toMatch(/^---/);
    expect(description).not.toMatch(UPSTREAM_BRAND);
  });

  it("has a page body only in English (the default) and Slovenian", () => {
    const files = fs
      .readdirSync(__dirname)
      .filter((file) => file.startsWith("DESCRIPTION"))
      .sort();
    expect(files).toEqual(["DESCRIPTION.md", "DESCRIPTION.sl.md"]);
  });
});
