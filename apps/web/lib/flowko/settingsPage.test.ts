// Flowko U29a: requireBusinessOwnerPage and the three /settings/podjetje pages (S15). Business A: Olga (OWNER), Ana
// (WORKER), Rok (STAFF), Dan (locked WORKER); a stranger in no business. Real helper on prismock through the global
// client; redirect is mocked. The pages are pinned by source assertions (as deskRoute.test.ts pins /koledar): each
// reads the session, sends a missing one to the login, then calls the guard once, outside any try block.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
import "@calcom/prisma";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { addLoginMember, createBusiness } from "@calcom/features/flowkoBusiness/business";
import type { FlowkoDb } from "@calcom/features/flowkoBusiness/db";
import { FLOWKO_SETTINGS_NO_BUSINESS_HOME, requireBusinessOwnerPage } from "./settingsPage";

const db = prismock as unknown as FlowkoDb;
let seq = 0;

async function makeUser(name: string): Promise<{ id: number }> {
  seq += 1;
  const username = `${name.toLowerCase()}${seq}`;
  const user = await prismock.user.create({
    data: { email: `${username}@example.com`, username, name },
    select: { id: true },
  });
  return { id: user.id };
}

type Fixture = {
  olga: { id: number };
  ana: { id: number };
  rok: { id: number };
  dan: { id: number };
  stranger: { id: number };
  businessId: number;
};
let f: Fixture;

beforeEach(async () => {
  mocks.redirect.mockClear();
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga.id,
    name: "Salon Settings",
    slug: `salon-settings-${seq}`,
    templateId: "hair-salon",
    phone: "+386 1 234 56 78",
    address: "Slovenska cesta 1, Ljubljana",
  });
  const ana = await makeUser("Ana");
  const rok = await makeUser("Rok");
  const dan = await makeUser("Dan");
  const stranger = await makeUser("Stranger");
  await addLoginMember(db, created.businessId, ana.id, FlowkoBusinessRole.WORKER);
  await addLoginMember(db, created.businessId, rok.id, FlowkoBusinessRole.STAFF);
  const danMember = await addLoginMember(db, created.businessId, dan.id, FlowkoBusinessRole.WORKER);
  await prismock.flowkoBusinessMember.update({
    where: { id: danMember.memberId },
    data: { status: FlowkoMemberStatus.LOCKED, lockedAt: new Date() },
  });
  f = { olga, ana, rok, dan, stranger, businessId: created.businessId };
});

describe("requireBusinessOwnerPage", () => {
  it("returns the business of the owner and does not redirect", async () => {
    await expect(requireBusinessOwnerPage(f.olga.id)).resolves.toEqual({ businessId: f.businessId });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["Ana (WORKER)", () => f.ana.id],
    ["Rok (STAFF)", () => f.rok.id],
  ])("sends %s to the desk", async (_name, id) => {
    await expect(requireBusinessOwnerPage(id())).rejects.toThrow("NEXT_REDIRECT /koledar");
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith("/koledar");
  });

  it.each([
    ["Dan (locked WORKER)", () => f.dan.id],
    ["a user in no business", () => f.stranger.id],
    ["an unknown user id", () => 987654],
  ])("sends %s to Cal's own settings", async (_name, id) => {
    expect(FLOWKO_SETTINGS_NO_BUSINESS_HOME).toBe("/settings/my-account/profile");
    await expect(requireBusinessOwnerPage(id())).rejects.toThrow(
      "NEXT_REDIRECT /settings/my-account/profile"
    );
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith("/settings/my-account/profile");
  });

  it("a locked owner account (User.locked) has no settings either", async () => {
    await prismock.user.update({ where: { id: f.olga.id }, data: { locked: true } });
    await expect(requireBusinessOwnerPage(f.olga.id)).rejects.toThrow(
      "NEXT_REDIRECT /settings/my-account/profile"
    );
  });
});

const ROOT = resolve(__dirname, "../../../..");
const DIR = "apps/web/app/(use-page-wrapper)/settings/(settings-layout)/podjetje";
const read = (file: string): string => readFileSync(resolve(ROOT, file), "utf8");
const PAGES = [`${DIR}/page.tsx`, `${DIR}/profil/page.tsx`, `${DIR}/storitve/page.tsx`];

describe("the /settings/podjetje pages call the guard after their session read", () => {
  it.each(PAGES)("%s", (file) => {
    const source = read(file);
    expect(source.trimStart().startsWith("// Flowko U29a:")).toBe(true);
    expect(source).toContain('import { requireBusinessOwnerPage } from "@lib/flowko/settingsPage";');
    const sessionRead = source.indexOf("await getServerSession(");
    const loginRedirect = source.indexOf('redirect("/auth/login")');
    const guard = source.indexOf("await requireBusinessOwnerPage(session.user.id);");
    expect(sessionRead).toBeGreaterThan(-1);
    expect(loginRedirect).toBeGreaterThan(sessionRead);
    expect(guard).toBeGreaterThan(loginRedirect);
    // exactly one call, and no try block anywhere in the page (Next's redirect throws)
    expect(source.match(/requireBusinessOwnerPage\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\btry\s*\{/);
  });

  it("/settings/podjetje sends the owner on to the profile, after the guard", () => {
    const source = read(`${DIR}/page.tsx`);
    const guard = source.indexOf("await requireBusinessOwnerPage(session.user.id);");
    const onward = source.indexOf('redirect("/settings/podjetje/profil")');
    expect(onward).toBeGreaterThan(guard);
  });

  it.each([
    [`${DIR}/profil/page.tsx`, "flowko_settings_profile", "/settings/podjetje/profil"],
    [`${DIR}/storitve/page.tsx`, "flowko_settings_services", "/settings/podjetje/storitve"],
  ])("%s has its title, description and path", (file, key, path) => {
    const source = read(file);
    expect(source).toContain(`t("${key}")`);
    expect(source).toContain(`t("${key}_description")`);
    expect(source).toContain(`"${path}"`);
  });

  it.each([`${DIR}/profil/loading.tsx`, `${DIR}/storitve/loading.tsx`])("%s is a Flowko file", (file) => {
    expect(read(file).trimStart().startsWith("// Flowko U29a:")).toBe(true);
  });
});
