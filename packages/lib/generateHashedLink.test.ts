import short from "short-uuid";
import { v5 as uuidv5 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateHashedLink, isGeneratedHashedLink } from "./generateHashedLink";

// The format every private link has had: short-uuid's flickrBase58, padded to 22 characters.
const FLICKR_BASE58 = /^[1-9a-km-zA-HJ-NP-Z]{22}$/;
const FROZEN_NOW = new Date("2026-09-24T10:00:00.000Z");

// What the old code produced for this id at this millisecond (anyone could compute it offline).
const legacyHashedLink = (id: number | string, ms: number) =>
  short().fromUUID(uuidv5(`${id}:${ms}`, uuidv5.URL));

describe("generateHashedLink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives different links for the same id in the same millisecond", () => {
    const first = generateHashedLink(42);
    const second = generateHashedLink(42);

    expect(first).not.toEqual(second);
  });

  it("is not derivable from the id and the creation time", () => {
    const link = generateHashedLink(42);

    expect(link).not.toEqual(legacyHashedLink(42, FROZEN_NOW.getTime()));
  });

  it("keeps the short-uuid format of existing links", () => {
    const link = generateHashedLink(42);
    const legacy = legacyHashedLink(42, FROZEN_NOW.getTime());

    expect(link).toMatch(FLICKR_BASE58);
    expect(legacy).toMatch(FLICKR_BASE58);
    expect(link).toHaveLength(legacy.length);
  });

  it("encodes a random (version 4) uuid", () => {
    const uuid = short().toUUID(generateHashedLink(42));

    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("still accepts every caller's argument shape", () => {
    expect(generateHashedLink("7-0")).toMatch(FLICKR_BASE58);
    expect(generateHashedLink(undefined)).toMatch(FLICKR_BASE58);
    expect(generateHashedLink()).toMatch(FLICKR_BASE58);
  });

  it("does not repeat across many calls", () => {
    const links = new Set(Array.from({ length: 1000 }, () => generateHashedLink(42)));

    expect(links.size).toBe(1000);
  });
});

describe("isGeneratedHashedLink", () => {
  it("accepts a link generateHashedLink made", () => {
    expect(isGeneratedHashedLink(generateHashedLink(42))).toBe(true);
  });

  it("refuses a link the old code derived from the id and the time", () => {
    const legacy = legacyHashedLink(42, FROZEN_NOW.getTime());

    expect(legacy).toMatch(FLICKR_BASE58);
    expect(isGeneratedHashedLink(legacy)).toBe(false);
  });

  it("refuses anything that is not the canonical short form of a v4 uuid", () => {
    expect(isGeneratedHashedLink("a")).toBe(false);
    expect(isGeneratedHashedLink("")).toBe(false);
    expect(isGeneratedHashedLink(undefined)).toBe(false);
    expect(isGeneratedHashedLink(42)).toBe(false);
    // 22 alphabet characters that decode past 128 bits (the decoder would truncate them).
    expect(isGeneratedHashedLink("zzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
    // The nil uuid.
    expect(isGeneratedHashedLink("1111111111111111111111")).toBe(false);
    // A v4 uuid's short form with a character outside the alphabet.
    expect(isGeneratedHashedLink(`${generateHashedLink().slice(0, 21)}0`)).toBe(false);
  });
});
