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
