import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import renderEmail from "../renderEmail";

// Flowko: the team-invite, org auto-invite and org-creation e-mails linked "contact our support team" to
// support@cal.com. They now mail SUPPORT_MAIL_ADDRESS (U12); a getter lets the test set it.
const mockConstants = vi.hoisted(() => ({ supportMailAddress: "support@example.com" }));
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  get SUPPORT_MAIL_ADDRESS(): string {
    return mockConstants.supportMailAddress;
  },
}));

const language = ((key: string) => key) as unknown as TFunction;

const teamInvite = {
  language,
  from: "owner@example.com",
  to: "member@example.com",
  teamName: "Ekipa",
  joinLink: "https://booking.example.com/join",
  isCalcomMember: false,
  isAutoJoin: false,
  isOrg: false,
  parentTeamName: undefined,
  isExistingUserMovedToOrg: false,
  prevLink: null,
  newLink: null,
};

const renders: [string, () => Promise<string>][] = [
  ["TeamInviteEmail (team)", () => renderEmail("TeamInviteEmail", teamInvite)],
  [
    "TeamInviteEmail (organization)",
    () =>
      renderEmail("TeamInviteEmail", {
        ...teamInvite,
        isOrg: true,
        isCalcomMember: true,
        isExistingUserMovedToOrg: true,
        prevLink: "https://booking.example.com/member",
        newLink: "https://acme.booking.example.com/member",
      }),
  ],
  [
    "OrgAutoInviteEmail",
    () =>
      renderEmail("OrgAutoInviteEmail", {
        language,
        from: "owner@example.com",
        to: "member@example.com",
        orgName: "Acme",
        joinLink: "https://booking.example.com/join",
      }),
  ],
  [
    "OrganizationCreationEmail",
    () =>
      renderEmail("OrganizationCreationEmail", {
        language,
        from: "owner@example.com",
        to: "owner@example.com",
        ownerNewUsername: "owner",
        ownerOldUsername: null,
        orgDomain: "acme.booking.example.com",
        orgName: "Acme",
        prevLink: null,
        newLink: "https://acme.booking.example.com/owner",
      }),
  ],
];

// The "contact" link of the "have_any_questions … contact … our_support_team" footer (keys, not copy: t is identity)
const supportLinkHref = (html: string) => /<a href="([^"]*)"[^>]*>contact<\/a>/.exec(html)?.[1];

describe("support link in the invite and organization e-mails", () => {
  it.each(renders)("%s renders and mails SUPPORT_MAIL_ADDRESS", async (_name, render) => {
    const html = await render();

    expect(html).toContain("have_any_questions");
    expect(supportLinkHref(html)).toBe("mailto:support@example.com");
    expect(html).not.toMatch(/(support|help)@cal\.(com|diy)/);
  });

  it.each(renders)("%s follows SUPPORT_MAIL_ADDRESS when it changes", async (_name, render) => {
    mockConstants.supportMailAddress = "info@example.com";
    try {
      expect(supportLinkHref(await render())).toBe("mailto:info@example.com");
    } finally {
      mockConstants.supportMailAddress = "support@example.com";
    }
  });
});
