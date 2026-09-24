import type { LocationObject } from "@calcom/app-store/locations";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { isBookerLocationOffered } from "./isBookerLocationOffered";

const t = ((key: string) => (key === "in_person" ? "In Person (Organizer Address)" : key)) as TFunction;

// What the booker form sends: getBookingData turns { value, optionValue } into optionValue || value
const bookerSends = (eventTypeLocations: LocationObject[], value: string, optionValue = "") =>
  isBookerLocationOffered({
    location: value === "conferencing" ? value : optionValue || value,
    response: { value, optionValue },
    eventTypeLocations,
    translators: [t],
  });

const inPersonOnly: LocationObject[] = [{ type: "inPerson", address: "Slovenska 1, Ljubljana" }];

describe("isBookerLocationOffered", () => {
  it("refuses an app location the event type doesn't offer", () => {
    expect(bookerSends(inPersonOnly, "integrations:google:meet")).toBe(false);
    expect(bookerSends(inPersonOnly, "integrations:daily")).toBe(false);
    expect(bookerSends(inPersonOnly, "integrations:zoom")).toBe(false);
    expect(bookerSends(inPersonOnly, "conferencing")).toBe(false);
    expect(bookerSends(inPersonOnly, "link")).toBe(false);
  });

  it("allows no location and the offered one", () => {
    expect(bookerSends(inPersonOnly, "")).toBe(true);
    expect(bookerSends(inPersonOnly, "inPerson")).toBe(true);
    expect(
      isBookerLocationOffered({ location: "", response: undefined, eventTypeLocations: [], translators: [t] })
    ).toBe(true);
  });

  it("lets the booker choose any of several offered locations, and conferencing only when offered", () => {
    const locations: LocationObject[] = [
      { type: "inPerson", address: "Slovenska 1" },
      { type: "integrations:google:meet" },
      { type: "conferencing" },
    ];
    expect(bookerSends(locations, "integrations:google:meet")).toBe(true);
    expect(bookerSends(locations, "conferencing")).toBe(true);
    expect(bookerSends(locations, "inPerson")).toBe(true);
    expect(bookerSends(locations, "integrations:daily")).toBe(false);
  });

  it("keeps the booker's own address, phone number and free text for a location that asks for it", () => {
    expect(bookerSends([{ type: "attendeeInPerson" }], "attendeeInPerson", "Trubarjeva 5, Maribor")).toBe(
      true
    );
    expect(bookerSends([{ type: "phone" }], "phone", "+38640123456")).toBe(true);
    expect(bookerSends([{ type: "somewhereElse" }], "somewhereElse", "Kavarna Union")).toBe(true);
  });

  it("refuses the booker's own input when booking would read it as a location type", () => {
    expect(bookerSends([{ type: "attendeeInPerson" }], "attendeeInPerson", "integrations:google:meet")).toBe(
      false
    );
    expect(bookerSends([{ type: "somewhereElse" }], "somewhereElse", "integrations:daily")).toBe(false);
    expect(bookerSends([{ type: "somewhereElse" }], "somewhereElse", "conferencing")).toBe(false);
  });

  it("refuses own input for an option that doesn't ask for it, or an option that isn't offered", () => {
    const locations: LocationObject[] = [
      { type: "inPerson", address: "Slovenska 1" },
      { type: "attendeeInPerson" },
    ];
    expect(bookerSends(locations, "inPerson", "https://example.com/phish")).toBe(false);
    expect(bookerSends(locations, "integrations:google:meet", "Trubarjeva 5")).toBe(false);
    expect(bookerSends(locations, "", "Trubarjeva 5")).toBe(false);
    expect(bookerSends(locations, "attendeeInPerson", "Trubarjeva 5")).toBe(true);
  });

  it("accepts the label the form sends for one of several locations of the same organizer-input type", () => {
    const branches: LocationObject[] = [
      { type: "inPerson", address: "Slovenska 1", displayLocationPublicly: true },
      { type: "inPerson", address: "Trubarjeva 5", customLabel: "Salon Maribor" },
      { type: "inPerson", address: "Prešernova 3" },
    ];
    expect(bookerSends(branches, "Slovenska 1")).toBe(true);
    expect(bookerSends(branches, "Salon Maribor")).toBe(true);
    // a private address without a custom label shows as the translated "in person" label
    expect(bookerSends(branches, "In Person (Organizer Address)")).toBe(true);
    expect(bookerSends(branches, "Prešernova 3")).toBe(false);
    expect(bookerSends(branches, "Somewhere I made up")).toBe(false);
  });

  it("checks the legacy location string on its own", () => {
    const check = (location: unknown, eventTypeLocations: LocationObject[]) =>
      isBookerLocationOffered({ location, response: undefined, eventTypeLocations, translators: [t] });
    expect(check("integrations:google:meet", inPersonOnly)).toBe(false);
    expect(check("Anything", inPersonOnly)).toBe(false);
    expect(check("inPerson", inPersonOnly)).toBe(true);
    expect(check("Trubarjeva 5", [{ type: "attendeeInPerson" }])).toBe(true);
    expect(check("integrations:daily", [{ type: "attendeeInPerson" }])).toBe(false);
    expect(check(42, inPersonOnly)).toBe(false);
  });

  it("refuses an answer that isn't text", () => {
    expect(
      isBookerLocationOffered({
        location: "",
        response: { value: { type: "integrations:daily" }, optionValue: "" },
        eventTypeLocations: inPersonOnly,
        translators: [t],
      })
    ).toBe(false);
  });
});
