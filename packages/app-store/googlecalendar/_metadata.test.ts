import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { metadata } from "./_metadata";

// Google's OAuth verification reviewer sees /apps/google-calendar, so it must present Flowko as the
// publisher and describe what the app does with the calendar, not Cal.diy's upstream copy.
const UPSTREAM_BRAND = /cal\.diy|cal\.com/i;

const DESCRIPTION_FRONTMATTER = "---\nitems:\n  - GCal1.png\n  - GCal2.png\n---\n\n";

const DESCRIPTION_BODY =
  "Povežite Google Calendar z aplikacijo Flowko Rezervacije. Aplikacija bo brala seznam vaših koledarjev in čase, ko ste zasedeni v koledarjih, ki jih izberete, da stranke ne morejo rezervirati terminov, ko ste zasedeni. Vsako rezervacijo doda v koledar, ki ga izberete, jo ob spremembi posodobi in ob odpovedi izbriše. Vsebine drugih dogodkov ne bere.\n" +
  "\n" +
  "Povezavo lahko kadar koli prekinete v razdelku Aplikacije → Nameščene aplikacije → Koledarji ali na strani https://myaccount.google.com/connections. Več v razdelku 3.3 pravilnika o zasebnosti: https://flowko.si/privacy\n";

describe("Google Calendar app page", () => {
  it("names Flowko as the publisher and contact", () => {
    expect(metadata.publisher).toBe("Flowko");
    expect(metadata.url).toBe("https://flowko.si/");
    expect(metadata.email).toBe("rezervacije@flowko.si");
  });

  it("describes the app in Slovenian", () => {
    expect(metadata.description).toBe(
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

  it("keeps the screenshots and replaces the page body with Flowko's description", () => {
    const description = fs.readFileSync(path.join(__dirname, "DESCRIPTION.md"), "utf8");
    expect(description).toBe(DESCRIPTION_FRONTMATTER + DESCRIPTION_BODY);
    expect(description).not.toMatch(UPSTREAM_BRAND);
  });
});
