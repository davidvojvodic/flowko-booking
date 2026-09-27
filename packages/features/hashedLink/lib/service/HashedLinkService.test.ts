import short from "short-uuid";
import { v5 as uuidv5 } from "uuid";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateHashedLink } from "@calcom/lib/generateHashedLink";
import { HttpError } from "@calcom/lib/http-error";
import type { MembershipService } from "@calcom/features/membership/services/membershipService";

import type { HashedLinkRepository } from "../repository/HashedLinkRepository";
import { HashedLinkService, PRIVATE_LINK_NOT_GENERATED } from "./HashedLinkService";

// Flowko (U8e): the private link comes from the client (update.handler's multiplePrivateLinks), and the server
// used to store any string it got
describe("HashedLinkService: only links generateHashedLink made are created", () => {
  const repository = {
    deleteLinks: vi.fn(),
    createLink: vi.fn(),
    updateLink: vi.fn(),
  };
  const service = new HashedLinkService({
    hashedLinkRepository: repository as unknown as HashedLinkRepository,
    membershipService: {} as MembershipService,
  });

  // What a tab still running the pre-U8d bundle sends: uuidv5(`${userId}:${Date.now()}`) in short-uuid form,
  // the same alphabet and length as a random one
  const LEGACY_DERIVED_LINK = short().fromUUID(uuidv5(`42:${Date.parse("2026-09-24T10:00:00Z")}`, uuidv5.URL));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const expectRefused = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 400, message: PRIVATE_LINK_NOT_GENERATED });
    expect(repository.deleteLinks).not.toHaveBeenCalled();
    expect(repository.createLink).not.toHaveBeenCalled();
    expect(repository.updateLink).not.toHaveBeenCalled();
  };

  it.each([
    ["a short guessable string", "abc"],
    ["a string with the right length but another alphabet", "0000000000000000000000"],
    ["the short form of a uuidv5 (the pre-U8d derived link)", LEGACY_DERIVED_LINK],
    ["an empty string", ""],
  ])("refuses a new link that is %s, and writes nothing", async (_label, link) => {
    await expectRefused(
      service.handleMultiplePrivateLinks({
        eventTypeId: 5,
        multiplePrivateLinks: [generateHashedLink(), { link, expiresAt: null }],
        connectedMultiplePrivateLinks: ["old-link-kept-or-deleted"],
      })
    );
  });

  it("creates a link generateHashedLink made, as a string or with options", async () => {
    const plain = generateHashedLink();
    const withOptions = { link: generateHashedLink(), expiresAt: null, maxUsageCount: 3 };

    await service.handleMultiplePrivateLinks({
      eventTypeId: 5,
      multiplePrivateLinks: [plain, withOptions],
      connectedMultiplePrivateLinks: [],
    });

    expect(repository.createLink).toHaveBeenCalledWith(5, { link: plain, expiresAt: null });
    expect(repository.createLink).toHaveBeenCalledWith(5, withOptions);
  });

  it("keeps updating and deleting links that were stored before, legacy ones included", async () => {
    const fresh = generateHashedLink();

    await service.handleMultiplePrivateLinks({
      eventTypeId: 5,
      multiplePrivateLinks: [{ link: "legacy-kept", expiresAt: null, maxUsageCount: 2 }, fresh],
      connectedMultiplePrivateLinks: ["legacy-kept", LEGACY_DERIVED_LINK],
    });

    expect(repository.deleteLinks).toHaveBeenCalledWith(5, [LEGACY_DERIVED_LINK]);
    expect(repository.updateLink).toHaveBeenCalledWith(5, {
      link: "legacy-kept",
      expiresAt: null,
      maxUsageCount: 2,
    });
    expect(repository.createLink).toHaveBeenCalledTimes(1);
    expect(repository.createLink).toHaveBeenCalledWith(5, { link: fresh, expiresAt: null });
  });

  it("refuses the same in createLinkForEventType", async () => {
    await expectRefused(service.createLinkForEventType(5, "abc"));

    const link = generateHashedLink();
    await service.createLinkForEventType(5, link);
    expect(repository.createLink).toHaveBeenCalledWith(5, { link, expiresAt: null });
  });
});
