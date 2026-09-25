import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Flowko: upstream shipped GCal1.png and GCal2.png here, screenshots of Cal.com's own calendar with
// other people's calendar names. copy-app-store-static.js serves everything in static/ under
// /app-store/googlecalendar/, so an upstream merge that brings them back would publish them again.
describe("googlecalendar static files", () => {
  it("serves only the app icon", () => {
    // Dotfiles are skipped: Finder writes .DS_Store (gitignored) into any folder opened on a Mac,
    // which would fail this pin locally for no real reason.
    const files = fs
      .readdirSync(path.join(__dirname, "static"))
      .filter((file) => !file.startsWith("."))
      .sort();
    expect(files).toEqual(["icon.svg"]);
  });
});
