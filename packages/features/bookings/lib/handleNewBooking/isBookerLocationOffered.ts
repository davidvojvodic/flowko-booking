import type { LocationObject } from "@calcom/app-store/locations";
import {
  getLocationByType,
  getOrganizerInputLocationTypes,
  OrganizerDefaultConferencingAppType,
  privacyFilteredLocations,
} from "@calcom/app-store/locations";
import type { TFunction } from "i18next";
import getLocationsOptionsForSelect from "../getLocationOptionsForSelect";

type BookerLocationResponse = { value?: unknown; optionValue?: unknown } | null | undefined;

// Booking treats a value containing this as a video app's location (EventManager.isDedicatedIntegration)
const INTEGRATION_LOCATION_MARKER = "integrations:";

/**
 * The option values the booker form sends for the event type's locations (BookingFields.tsx): a location's
 * type, or its label when the event type holds the same organizer-input type (in person, link, organizer
 * phone) more than once. The form builds that label in the booker's language from the public locations.
 */
function getOfferedChoices(eventTypeLocations: LocationObject[], translators: TFunction[]) {
  const choices = new Set(eventTypeLocations.map((location) => location.type));
  const organizerInputTypes: string[] = getOrganizerInputLocationTypes();
  const publicLocations = privacyFilteredLocations(eventTypeLocations) as LocationObject[];
  for (const t of translators) {
    const options = getLocationsOptionsForSelect(publicLocations, t);
    for (const option of options) {
      const isRepeatedOrganizerInputType =
        organizerInputTypes.includes(option.value) &&
        options.filter((other) => other.value === option.value).length > 1;
      if (isRepeatedOrganizerInputType) choices.add(option.label);
    }
  }
  return choices;
}

/**
 * Flowko: the location a booker sends must be one the event type offers. Otherwise an anonymous booker picks
 * any app's location (Google Meet, Cal Video, ...) on an in-person event type, and booking runs that app.
 *
 * `location` is the value booking uses (getBookingData: the option's own input, else the option, "" for none),
 * `response` the booker's location answer ({ value: option, optionValue: own input }) when there is one.
 * Allowed: nothing (the event type's first location applies), an offered option, and the booker's own input
 * (an address, a phone number, free text) for an offered location that asks for it, as long as booking
 * wouldn't read that input as a location type. "conferencing" (the organizer's default app) only when offered.
 */
export function isBookerLocationOffered({
  location,
  response,
  eventTypeLocations,
  translators,
}: {
  location: unknown;
  response: BookerLocationResponse;
  eventTypeLocations: LocationObject[];
  translators: TFunction[];
}): boolean {
  if (typeof location !== "string") return false;
  const offeredTypes = new Set(eventTypeLocations.map((eventTypeLocation) => eventTypeLocation.type));
  const takesBookerInput = (type: string) =>
    offeredTypes.has(type) && !!getLocationByType(type)?.attendeeInputType;
  const isReadAsLocationType = (value: string) =>
    value.includes(INTEGRATION_LOCATION_MARKER) || !!getLocationByType(value);

  const offeredChoices = getOfferedChoices(eventTypeLocations, translators);
  const isOfferedChoice = (value: string) => offeredChoices.has(value);

  const isBookerInput = Array.from(offeredTypes).some(takesBookerInput) && !isReadAsLocationType(location);
  if (location && !isOfferedChoice(location) && !isBookerInput) return false;

  if (response) {
    const { value = "", optionValue = "" } = response;
    if (typeof value !== "string" || typeof optionValue !== "string") return false;
    if (value && !isOfferedChoice(value)) return false;
    // getBookingData ignores the optionValue of "conferencing"; every other option has its own input only
    // when it asks the booker for one (the form clears it on each change of option)
    if (optionValue && value !== OrganizerDefaultConferencingAppType && !takesBookerInput(value))
      return false;
  }
  return true;
}
