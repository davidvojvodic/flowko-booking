import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import type { FlowkoSnippetType } from "@calcom/features/embed/lib/buildFlowkoSnippet";
import { buildFlowkoSnippet, getFlowkoNamespace } from "@calcom/features/embed/lib/buildFlowkoSnippet";
import slugify from "@calcom/lib/slugify";

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
  // Flowko (U13 fix pass): the embed loader keeps namespaces (= the slug) in a plain object
  "constructor",
  "Constructor",
  "toString",
  "tostring",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
];
// Flowko (U13 fix pass): refused as sent by update and duplicate, which store the slug unslugified; create
// slugifies first ("__proto__" becomes "proto"), so it stores a harmless slug instead
// Flowko P0: a slug with "_" could be another event type's pop-up namespace ("ogled_lebdeci" is the floating
// button of "ogled"); slugify turns "_" into "-"
const RESERVED_UNLESS_SLUGIFIED = [
  "__proto__",
  "__defineGetter__",
  "__lookupSetter__",
  "ogled_lebdeci",
  "ogled_gumb",
  "ogled_povezava",
  "Pregled_Zob",
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
  "constructors",
  "konstruktor",
  "proto",
  "to-string",
  "value-of",
];

function slugIssues(result: {
  success: boolean;
  error?: { issues: { path: (string | number)[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).filter((issue) => issue.path.join(".") === "slug");
}

describe("isReservedEventTypeSlug", () => {
  it.each([...RESERVED, ...RESERVED_UNLESS_SLUGIFIED])("refuses %j", (slug) => {
    expect(isReservedEventTypeSlug(slug)).toBe(true);
  });

  it.each(ALLOWED)("allows %j", (slug) => {
    expect(isReservedEventTypeSlug(slug)).toBe(false);
  });

  // Flowko (U13 fix pass): the slug is the snippet's namespace, and the loader keeps namespaces in a plain
  // object (cal.ns = {}), so a name every object has finds the inherited property instead of a new queue.
  // Flowko P0: the pop-up codes add a suffix to the slug, but the calendar (inline) code still uses the bare
  // slug, so the rule stays.
  describe("names the embed loader can't take as a namespace", () => {
    /** Runs the snippet's script for this namespace, as a client's page would. */
    function runSnippet(namespace: string, type: FlowkoSnippetType = "inline") {
      const html = buildFlowkoSnippet({
        type,
        calLink: `flowko-test/${namespace}`,
        namespace,
        origin: "https://booking.flowko.si",
        embedLibUrl: "https://booking.flowko.si/embed/embed.js",
      });
      const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
      const window: Record<string, unknown> = {
        // addEventListener takes the click-link script's listener
        document: {
          head: { appendChild: (el: object) => el },
          createElement: () => ({}),
          addEventListener: () => undefined,
        },
      };
      window.window = window;
      runInNewContext(script, window);
      return window.Cal as { ns: Record<string, { q: unknown[][] }> };
    }

    it("a normal slug gets its own queue", () => {
      const cal = runSnippet("ogled");
      expect(cal.ns.ogled.q.map((args) => Array.from(args)[0])).toEqual(["init", "inline", "ui"]);
    });

    it.each(Object.getOwnPropertyNames(Object.prototype))("%s breaks the loader and is reserved", (name) => {
      // The TypeError comes from the vm's realm, so it is not this realm's TypeError
      expect(() => runSnippet(name)).toThrow(/push/);
      // The pop-up codes' suffixed namespaces are ordinary keys; the calendar's bare slug is what breaks
      for (const type of ["floating-popup", "element-click", "click-link"] as const) {
        expect(() => runSnippet(name, type)).not.toThrow();
      }
      expect(isReservedEventTypeSlug(name)).toBe(true);
      expect(isReservedEventTypeSlug(name.toLowerCase())).toBe(true);
    });
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

  it.each(RESERVED_UNLESS_SLUGIFIED)("update and duplicate refuse %j, create slugifies it", (slug) => {
    for (const result of [update(slug), duplicate(slug)]) {
      expect(result.success).toBe(false);
      expect(slugIssues(result).map((issue) => issue.message)).toEqual([RESERVED_EVENT_TYPE_SLUG_MESSAGE]);
    }
    const created = create(slug);
    expect(created.success).toBe(true);
    expect(created.success && created.data.slug).toBe(slugify(slug));
  });

  it.each(ALLOWED)("accepts %j", (slug) => {
    expect(create(slug).success).toBe(true);
    expect(update(slug).success).toBe(true);
    expect(duplicate(slug).success).toBe(true);
  });

  // Flowko P0: the pop-up codes' namespaces are the slug plus "_" and a word, so no stored slug may contain "_"
  const POP_UP_TYPES = ["floating-popup", "element-click", "click-link"] as const;
  it.each(POP_UP_TYPES)("no stored slug can be the %s code's namespace", (type) => {
    const namespace = getFlowkoNamespace(type, "ogled");
    expect(update(namespace).success).toBe(false);
    expect(duplicate(namespace).success).toBe(false);
    const created = create(namespace);
    expect(created.success && created.data.slug).toBe(namespace.replace("_", "-"));
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
