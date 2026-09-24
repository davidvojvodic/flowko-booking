import { LINK_TOKEN_KEY_LABEL, symmetricDecrypt, symmetricDecryptAuthenticated } from "@calcom/lib/crypto";
import type { ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizerRequestEmail } from "./OrganizerRequestEmail";

const TEST_KEY = "abcdefghjnmkljhjklmnhjklkmnbhjui"; // 32 bytes, like CALENDSO_ENCRYPTION_KEY

const collectHrefs = (node: ReactNode, hrefs: string[] = []): string[] => {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { href?: unknown; children?: ReactNode };
    if (typeof props.href === "string") hrefs.push(props.href);
    collectHrefs(props.children, hrefs);
  });
  return hrefs;
};

const renderLinks = () => {
  const props = {
    calEvent: {
      uid: "booking-a",
      organizer: { id: 1, language: { translate: (key: string) => key } },
    },
    attendee: {},
  } as unknown as Parameters<typeof OrganizerRequestEmail>[0];
  const element = OrganizerRequestEmail(props) as ReactElement<{ callToAction: ReactNode }>;
  return collectHrefs(element.props.callToAction).map((href) => new URL(href));
};

// Flowko: NAR-1. The emailed confirm/reject link must carry an authenticated token that /api/link accepts.
describe("OrganizerRequestEmail link token", () => {
  beforeEach(() => {
    vi.stubEnv("CALENDSO_ENCRYPTION_KEY", TEST_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("links accept and reject to /api/link with an authenticated token naming the booking and its organizer", () => {
    const before = Math.floor(Date.now() / 1000);
    const links = renderLinks();

    expect(links.map((url) => url.searchParams.get("action"))).toEqual(["accept", "reject"]);
    for (const url of links) {
      expect(url.pathname).toBe("/api/link/");
      const token = url.searchParams.get("token") ?? "";
      const payload = JSON.parse(symmetricDecryptAuthenticated(token, TEST_KEY, LINK_TOKEN_KEY_LABEL));
      expect(payload).toEqual(expect.objectContaining({ bookingUid: "booking-a", userId: 1 }));
      expect(payload.iat).toBeGreaterThanOrEqual(before);
      expect(payload.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    }
  });

  it("no longer issues the unauthenticated AES-256-CBC token", () => {
    const token = renderLinks()[0].searchParams.get("token") ?? "";
    expect(token).not.toContain(":");
    expect(() => symmetricDecrypt(token, TEST_KEY)).toThrow();
  });

  it("fails closed instead of issuing a token when CALENDSO_ENCRYPTION_KEY is missing", () => {
    vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "");
    expect(() => renderLinks()).toThrow();
  });
});
