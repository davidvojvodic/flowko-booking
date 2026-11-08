// Flowko U28: customer lookup (R11). One search field (name or phone); after 300 ms of quiet and from two
// characters on, `bookings.customers` answers with this business's earlier customers (the server decides name vs
// phone search and the minimum); a result hands over name/phone/e-mail, „Nova stranka“ asks for a blank customer.
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

export function CustomerField(props: { onPick: (customer: DeskCustomer) => void; onNew: () => void }) {
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
        <Button color="secondary" StartIcon="user-plus" onClick={props.onNew}>
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
