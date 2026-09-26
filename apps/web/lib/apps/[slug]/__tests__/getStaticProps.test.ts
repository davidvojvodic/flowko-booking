import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppWithMetadata: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({
  default: {},
  prisma: { app: { findUnique: mocks.findUnique } },
}));

vi.mock("@calcom/app-store/_appRegistry", () => ({
  getAppWithMetadata: mocks.getAppWithMetadata,
}));

import { metadata as googleCalendar } from "@calcom/app-store/googlecalendar/_metadata";
import { metadata as zoom } from "@calcom/app-store/zoomvideo/_metadata";

import { getDescriptionFilePath, getStaticProps, parseFrontmatter } from "../getStaticProps";

// getStaticProps reads packages/app-store/<dir>/ relative to apps/web, the Next.js server's working directory.
const REPO_ROOT = path.resolve(__dirname, "../../../../../..");
const APP_STORE = path.join(REPO_ROOT, "packages/app-store");

const readBody = (dirName: string, file: string) =>
  parseFrontmatter(fs.readFileSync(path.join(APP_STORE, dirName, file), "utf8")).content;

const serveApp = (meta: typeof googleCalendar) => {
  mocks.getAppWithMetadata.mockResolvedValue({ ...meta });
  mocks.findUnique.mockResolvedValue({ slug: meta.slug, dirName: meta.dirName, enabled: true });
};

describe("app page body by locale", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue(path.join(REPO_ROOT, "apps/web"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.getAppWithMetadata.mockReset();
    mocks.findUnique.mockReset();
  });

  describe("Google Calendar", () => {
    beforeEach(() => serveApp(googleCalendar));

    it("shows an English user the English page body", async () => {
      const props = await getStaticProps("google-calendar", "en");

      expect(props?.isAppDisabled).toBe(false);
      const content = props && !props.isAppDisabled ? props.source.content : undefined;
      expect(content).toBe(readBody("googlecalendar", "DESCRIPTION.md"));
      expect(content).toMatch(/^Connect Google Calendar to Flowko Rezervacije\./);
      expect(content).toContain("It does not read the contents of your other events.");
    });

    it("shows a Slovenian user the Slovenian page body", async () => {
      const props = await getStaticProps("google-calendar", "sl");

      const content = props && !props.isAppDisabled ? props.source.content : undefined;
      expect(content).toBe(readBody("googlecalendar", "DESCRIPTION.sl.md"));
      expect(content).toMatch(/^Povežite Google Calendar z aplikacijo Flowko Rezervacije\./);
      expect(content).toContain("Vsebine drugih dogodkov ne bere.");
    });

    it.each([
      ["de"],
      ["es-419"],
      ["xx"],
      [undefined],
    ])("shows the English page body for the locale %s", async (locale) => {
      const props = await getStaticProps("google-calendar", locale);

      const content = props && !props.isAppDisabled ? props.source.content : undefined;
      expect(content).toBe(readBody("googlecalendar", "DESCRIPTION.md"));
    });

    it("keeps the app's metadata, whatever the locale", async () => {
      const props = await getStaticProps("google-calendar", "sl");

      expect(props?.data).toMatchObject({ slug: "google-calendar", publisher: "Flowko" });
    });
  });

  it.each([["en"], ["sl"]])("shows another app its unchanged DESCRIPTION.md in %s", async (locale) => {
    serveApp(zoom as typeof googleCalendar);

    const props = await getStaticProps("zoom", locale);

    const content = props && !props.isAppDisabled ? props.source.content : undefined;
    expect(content).toBe(readBody("zoomvideo", "DESCRIPTION.md"));
  });
});

describe("getDescriptionFilePath", () => {
  const appDir = path.join(APP_STORE, "googlecalendar");

  it("picks the locale's file when the app has one", () => {
    expect(getDescriptionFilePath(appDir, "sl")).toBe(path.join(appDir, "DESCRIPTION.sl.md"));
  });

  it("falls back to DESCRIPTION.md for a configured locale without its own file", () => {
    expect(getDescriptionFilePath(appDir, "en")).toBe(path.join(appDir, "DESCRIPTION.md"));
    expect(getDescriptionFilePath(appDir, "de")).toBe(path.join(appDir, "DESCRIPTION.md"));
  });

  it("never builds a path from a locale that is not configured", () => {
    const existsSync = vi.spyOn(fs, "existsSync");

    expect(getDescriptionFilePath(appDir, "../../../README")).toBe(path.join(appDir, "DESCRIPTION.md"));
    expect(getDescriptionFilePath(appDir, "sl/../../zoomvideo/DESCRIPTION")).toBe(
      path.join(appDir, "DESCRIPTION.md")
    );
    expect(getDescriptionFilePath(appDir, "")).toBe(path.join(appDir, "DESCRIPTION.md"));
    expect(existsSync).not.toHaveBeenCalled();

    existsSync.mockRestore();
  });
});
