// Flowko U28: customer lookup (R11). One search field (name or phone); after 300 ms of quiet and from two
// characters on, `bookings.customers` answers with this business's earlier customers (the server decides name vs
// phone search and the minimum); a result hands over name/phone/e-mail, „Nova stranka“ asks for a blank customer.
// Flowko U28b: „Nova stranka“ hands over the typed text (letters → name, only phone characters → phone) and empties
// the search (B2); `CustomerCard` shows a picked customer compactly with „Zamenjaj“ (back to the search).
import { useState } from "react";

import type { DeskCustomer } from "@calcom/features/flowkoBusiness/desk";
import { useDebounce } from "@calcom/lib/hooks/useDebounce";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { TextField } from "@calcom/ui/components/form";

export const LOOKUP_DEBOUNCE_MS = 300;
/** R17: the route caps the query at 80 characters. */
const MAX_QUERY = 80;

// Flowko U28b: digits plus the usual phone separators (space, +, -, parentheses, slash, dot).
const PHONE_CHARS = /^[\d\s+\-()/.]+$/;
// Any letter of any script (č, š, ž …). The constructor form: the es5 tsconfig target refuses a `u` literal.
const LETTER = new RegExp("\\p{L}", "u");

export type CustomerPrefill = { name: string; phone: string };

/** Flowko U28b (B2): what „Nova stranka“ pre-fills from the search text: any letter → the name; only phone
 * characters with at least one digit → the phone; anything else → nothing. */
export function prefillFromSearch(text: string): CustomerPrefill {
  const value = text.trim();
  if (LETTER.test(value)) return { name: value, phone: "" };
  if (PHONE_CHARS.test(value) && /\d/.test(value)) return { name: "", phone: value };
  return { name: "", phone: "" };
}

export function CustomerField(props: {
  onPick: (customer: DeskCustomer) => void;
  onNew: (prefill: CustomerPrefill) => void;
}) {
  const { t } = useLocale();
  const [text, setText] = useState("");
  const query = useDebounce(text, LOOKUP_DEBOUNCE_MS).trim();
  const enabled = query.length >= 2;
  const lookup = trpc.viewer.flowko.bookings.customers.useQuery({ query }, { enabled, staleTime: 30_000 });
  const results = enabled ? lookup.data : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <TextField
          name="flowko-desk-customer-search"
          containerClassName="flex-1"
          label={t("flowko_desk_customer_search")}
          autoComplete="off"
          maxLength={MAX_QUERY}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          color="secondary"
          StartIcon="user-plus"
          onClick={() => {
            props.onNew(prefillFromSearch(text));
            setText("");
          }}>
          {t("flowko_desk_customer_new")}
        </Button>
      </div>
      {results && results.length === 0 && (
        <p className="text-subtle text-sm">{t("flowko_desk_customer_none")}</p>
      )}
      {results && results.length > 0 && (
        <ul className="border-subtle divide-subtle divide-y rounded-md border">
          {results.map((c) => (
            <li key={`${c.name}|${c.phone ?? ""}|${c.email ?? ""}`}>
              <button
                type="button"
                className="hover:bg-subtle flex min-h-11 w-full flex-col items-start px-3 py-2 text-left"
                onClick={() => {
                  props.onPick(c);
                  setText("");
                }}>
                <span className="text-emphasis text-sm font-medium">{c.name}</span>
                <span className="text-subtle text-xs">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Flowko U28b (B2): the chosen customer, compact; „Zamenjaj“ goes back to the search. */
export function CustomerCard(props: { customer: DeskCustomer; onChange: () => void }) {
  const { t } = useLocale();
  const { name, phone, email } = props.customer;
  return (
    <div
      data-testid="desk-customer-card"
      className="border-subtle bg-subtle flex items-center gap-3 rounded-md border px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-emphasis truncate text-sm font-medium">{name}</span>
        {phone && (
          <span data-testid="desk-customer-card-phone" className="text-subtle truncate text-xs">
            {phone}
          </span>
        )}
        {email && (
          <span data-testid="desk-customer-card-email" className="text-subtle truncate text-xs">
            {email}
          </span>
        )}
      </div>
      <Button color="secondary" size="sm" onClick={props.onChange}>
        {t("flowko_desk_customer_change")}
      </Button>
    </div>
  );
}
