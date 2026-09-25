import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Flowko: upstream shipped GCal1.png and GCal2.png here, screenshots of Cal.com's own calendar with
// other people's calendar names. copy-app-store-static.js serves everything in static/ under
// /app-store/googlecalendar/, so an upstream merge that brings them back would publish them again.
describe("googlecalendar static files", () => {
  it("serves only the app icon", () => {
    expect(fs.readdirSync(path.join(__dirname, "static")).sort()).toEqual(["icon.svg"]);
  });
});
