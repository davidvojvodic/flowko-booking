import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Flowko U22: the Docker image starts the app with `turbo run start` in Turbo's strict env mode, which passes the
// Next server only the variables listed in turbo.json. A runtime variable missing there never reaches the server:
// the reminder cron secret read as undefined and every cron call got 401 (found on release, 2026-11-06).
describe("turbo.json", () => {
  it("passes the reminder cron secret to the Next server", () => {
    const turbo = JSON.parse(readFileSync(resolve(__dirname, "../../../../turbo.json"), "utf8")) as {
      globalEnv?: string[];
    };
    expect(turbo.globalEnv).toContain("FLOWKO_REMINDER_CRON_SECRET");
  });
});
