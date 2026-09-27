type SearchParamsReader = Pick<URLSearchParams, "get" | "getAll"> | null | undefined;

/**
 * The name and guests the booking form is prefilled with from the page's query: `name` (or `firstName` and
 * `lastName`) and `guests` (or the legacy `guest`).
 *
 * Flowko U13-24 (David, Q11 (a)): inside an embed the guests are never prefilled. The embedding page writes the
 * iframe's query (the snippet's config), so it could add a guest the booker doesn't notice, and every guest receives
 * the booking's details and the attendees' names and e-mails. The booker can still add guests in the form.
 */
export function getBookerPrefillFormParams(searchParams: SearchParamsReader, { isEmbed }: { isEmbed: boolean }) {
  const firstNameQueryParam = searchParams?.get("firstName");
  const lastNameQueryParam = searchParams?.get("lastName");
  return {
    name:
      searchParams?.get("name") || (firstNameQueryParam ? `${firstNameQueryParam} ${lastNameQueryParam}` : null),
    guests: isEmbed ? [] : ((searchParams?.getAll("guests") || searchParams?.getAll("guest")) ?? []),
  };
}

/**
 * Whether this page runs inside an embed, known on the first client render: embed-iframe-init sets window.isEmbed when
 * @calcom/embed-core/embed-iframe is imported (from the `embed` query param, the iframe's name or an /embed path).
 * useIsEmbed only knows it after an effect, and the booking form takes its prefill from the first values it gets.
 * On the server it is false; the prefill is only read on the client.
 */
export function isEmbedFrame() {
  return typeof window !== "undefined" && !!window.isEmbed?.();
}
