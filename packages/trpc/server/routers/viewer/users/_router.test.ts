import { RESERVED_USERNAME_MESSAGE } from "@calcom/features/auth/signup/utils/reservedUsernames";
import { describe, expect, it } from "vitest";
import { userAdminRouter } from "./_router";

// Flowko (U13 hardening): Settings → Admin → Users (add, edit) can't give a user a reserved name either.
// The procedures' own input parsers are run, as tRPC runs them before the admin middleware's handler.

type Parser = {
  safeParse: (input: unknown) => {
    success: boolean;
    error?: { issues: { path: unknown[]; message: string }[] };
  };
};

function inputParser(name: "add" | "update"): Parser {
  const procedures = userAdminRouter._def.procedures as unknown as Record<
    string,
    { _def: { inputs: Parser[] } }
  >;
  const { inputs } = procedures[name]._def;
  // The body schema is the procedure's only input parser (the middleware reads userId from the raw input).
  expect(inputs).toHaveLength(1);
  return inputs[0];
}

const newUser = (username: string | null) => ({
  name: "Host",
  email: "host@example.com",
  username,
  bio: null,
  timeZone: "Europe/Ljubljana",
  weekStart: "Monday",
  theme: null,
  defaultScheduleId: null,
  locale: "sl",
  timeFormat: 24,
  allowDynamicBooking: false,
  identityProvider: "CAL",
  role: "USER",
  avatarUrl: null,
});

describe("admin users add/update refuse reserved usernames", () => {
  it.each(["embed", "Embed", "settings", "booking", "sl", "studio-embed"])("refuses %j", (username) => {
    for (const result of [
      inputParser("add").safeParse(newUser(username)),
      inputParser("update").safeParse({ username }),
    ]) {
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ path: ["username"], message: RESERVED_USERNAME_MESSAGE }),
      ]);
    }
  });

  it.each(["flowko-test", "embedded", "apps2"])("accepts %j", (username) => {
    expect(inputParser("add").safeParse(newUser(username)).success).toBe(true);
    expect(inputParser("update").safeParse({ username }).success).toBe(true);
  });

  it("accepts an edit without a username and a user without one", () => {
    expect(inputParser("update").safeParse({ name: "Host" }).success).toBe(true);
    expect(inputParser("add").safeParse(newUser(null)).success).toBe(true);
  });
});
