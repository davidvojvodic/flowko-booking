import short from "short-uuid";

// Flowko: the hash is the private link /d/<hash>/<slug>. It was uuidv5 of the user/event-type id and the
// creation millisecond, which an outsider can compute offline; now it is a random v4 uuid
// (crypto.randomFillSync on the server, crypto.getRandomValues in the browser) in the same short-uuid format.
// The id is no longer used; the parameter stays so every caller keeps compiling. Links made before keep working.
// It is NOT access control on its own: the booking API books a hidden event type by its id with no link,
// /<username>/<slug> renders a hidden event type too, and the link's expiry and usage budget are checked only
// after the booking exists. What the hash does today: it keeps the owner's username out of the /d/ URL, and
// the /d/ page stops rendering once the link has expired or is used up. It becomes a gate only when the
// booking service requires a valid link for the event type and consumes it before creating the booking.
export const generateHashedLink = (_id?: number | string) => {
  const translator = short();
  return translator.generate();
};

const SHORT_UUID_FORMAT = /^[1-9a-km-zA-HJ-NP-Z]{22}$/;
const UUID_V4_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Flowko: true only for a link generateHashedLink makes, for a server that stores a link the client sent.
// A tab still running the old bundle sends uuidv5(id:ms) links, which have the same alphabet and length,
// so the check decodes the link: it must be the canonical short form of a version 4 (random) uuid.
export const isGeneratedHashedLink = (link: unknown): link is string => {
  if (typeof link !== "string" || !SHORT_UUID_FORMAT.test(link)) return false;
  const translator = short();
  const uuid = translator.toUUID(link);
  return UUID_V4_FORMAT.test(uuid) && translator.fromUUID(uuid) === link;
};
