import short from "short-uuid";

// Flowko: the hash is the whole private link (/d/<hash>/<slug>), a bearer secret that lets anyone book the
// hidden event type. It was uuidv5 of the user/event-type id and the creation millisecond, which an outsider
// can compute offline; now it is a random v4 uuid (crypto.randomFillSync on the server,
// crypto.getRandomValues in the browser) in the same short-uuid format. The id is no longer used; the
// parameter stays so every caller keeps compiling. Links made before keep working.
export const generateHashedLink = (_id?: number | string) => {
  const translator = short();
  return translator.generate();
};
