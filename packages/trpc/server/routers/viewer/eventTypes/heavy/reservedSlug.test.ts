import { describe, expect, it } from "vitest";
import { ZCreateInputSchema } from "./create.schema";
import { ZDuplicateInputSchema } from "./duplicate.schema";
import { isReservedEventTypeSlug, RESERVED_EVENT_TYPE_SLUG_MESSAGE } from "./reservedSlug";
import { ZUpdateInputSchema } from "./update.schema";

// Flowko (U13 hardening): /<user>/embed is the profile embed, and embed.js adds no /embed to a link that
// already ends in "embed", so no event type may use such a slug.

const RESERVED = [
  "embed",
  "EMBED",
  "Embed ",
  " embed",
  "pregled-embed",
  "pregledembed",
  "x.embed",
  "embed/",
  "avatar.png",
];
const ALLOWED = [
  "ogled",
  "pregled-30min",
  "embedded",
  "embed-pregled",
  "embedx",
  "vgradnja",
  "avatar",
  "avatar-png",
];

function slugIssues(result: {
  success: boolean;
  error?: { issues: { path: (string | number)[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).filter((issue) => issue.path.join(".") === "slug");
}

describe("isReservedEventTypeSlug", () => {
  it.each(RESERVED)("refuses %j", (slug) => {
    expect(isReservedEventTypeSlug(slug)).toBe(true);
  });

  it.each(ALLOWED)("allows %j", (slug) => {
    expect(isReservedEventTypeSlug(slug)).toBe(false);
  });

  it("leaves a missing slug to the other checks", () => {
    expect(isReservedEventTypeSlug(undefined)).toBe(false);
    expect(isReservedEventTypeSlug(null)).toBe(false);
    expect(isReservedEventTypeSlug("")).toBe(false);
  });
});

describe("event type create/update/duplicate inputs refuse a reserved slug", () => {
  const create = (slug: string) => ZCreateInputSchema.safeParse({ title: "Ogled", slug, length: 30 });
  const update = (slug?: string) =>
    ZUpdateInputSchema.safeParse({ id: 1, ...(slug === undefined ? {} : { slug }) });
  const duplicate = (slug: string) =>
    ZDuplicateInputSchema.safeParse({ id: 1, slug, title: "Ogled", description: "", length: 30 });

  it.each(RESERVED)("refuses %j", (slug) => {
    for (const result of [create(slug), update(slug), duplicate(slug)]) {
      expect(result.success).toBe(false);
      expect(slugIssues(result).map((issue) => issue.message)).toEqual([RESERVED_EVENT_TYPE_SLUG_MESSAGE]);
    }
  });

  it.each(ALLOWED)("accepts %j", (slug) => {
    expect(create(slug).success).toBe(true);
    expect(update(slug).success).toBe(true);
    expect(duplicate(slug).success).toBe(true);
  });

  it("still slugifies the created slug", () => {
    const result = create("Pregled 30 min");
    expect(result.success && result.data.slug).toBe("pregled-30-min");
  });

  it("accepts an update that leaves the slug out", () => {
    expect(update().success).toBe(true);
    expect(ZUpdateInputSchema.safeParse({ id: 1, hidden: true }).success).toBe(true);
  });
});
