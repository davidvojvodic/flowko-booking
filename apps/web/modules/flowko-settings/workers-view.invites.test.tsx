// Flowko U29d (Task 7): invites on the owner's „Delavci“ page (U1–U5, D1). The list shows a desk-only member's
// open invite on its row („Povabljen“ / „Povabilo je poteklo“ + validity, resend / new link / revoke in place of
// „Povabi“), the „Povabljeni“ section for brand-new people, the „Povabi s prijavo“ form, the „Povabi“ dialog on a
// desk-only WORKER row and the one-time link panel. The link-minting calls go through the vanilla client
// (utils.client…mutate), never useMutation, so no answer with a link stays in the MutationCache.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkersView from "./workers-view";
import {
  ANA,
  BOR,
  BOR_INVITE,
  CENE,
  DAN,
  EVA,
  FRAN,
  GAJA,
  GAJA_INVITE,
  HANA_INVITE,
  IVA_INVITE,
  localeT,
  WORKERS_VIEW,
  WORKERS_VIEW_INVITES,
  type WorkersViewData,
} from "./settings.fixture";

const mocks = vi.hoisted(() => ({
  lang: "sl" as "sl" | "en",
  /** true = `t` escapes interpolated values like i18next's default (escapeValue true) unless the call opts out. */
  escape: true,
  query: vi.fn(),
  refetch: vi.fn(),
  invalidateList: vi.fn(),
  invalidateMembers: vi.fn(),
  invalidateDeskServices: vi.fn(),
  lock: vi.fn(),
  unlock: vi.fn(),
  add: vi.fn(),
  reorder: vi.fn(),
  invite: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  inviteUseMutation: vi.fn(),
  resendUseMutation: vi.fn(),
  toast: vi.fn(),
}));

// i18next's default escape (its _entityMap): & < > " ' and /.
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\//g, "&#x2F;");

/** i18next's default: interpolated strings are HTML-escaped unless `interpolation.escapeValue` is false. */
function testT(lang: "sl" | "en") {
  const base = localeT(lang);
  return (key: string, opts?: Record<string, unknown>) => {
    const interpolation = opts?.interpolation as { escapeValue?: boolean } | undefined;
    if (!mocks.escape || !opts || interpolation?.escapeValue === false) return base(key, opts);
    const escaped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(opts)) escaped[k] = typeof v === "string" ? escapeHtml(v) : v;
    return base(key, escaped);
  };
}

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: testT(mocks.lang), i18n: { language: mocks.lang } }),
}));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => mocks.toast(...args) }));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        viewer: {
          flowko: {
            workers: {
              invite: { mutate: (i: unknown) => mocks.invite(i) },
              resendInvite: { mutate: (i: unknown) => mocks.resend(i) },
            },
          },
        },
      },
      viewer: {
        flowko: {
          workers: { list: { invalidate: mocks.invalidateList } },
          business: {
            members: { invalidate: mocks.invalidateMembers },
            services: { invalidate: mocks.invalidateDeskServices },
          },
        },
      },
    }),
    viewer: {
      flowko: {
        workers: {
          list: { useQuery: (...args: unknown[]) => mocks.query(...args) },
          lock: { useMutation: () => ({ mutateAsync: (i: unknown) => mocks.lock(i), isPending: false }) },
          unlock: { useMutation: () => ({ mutateAsync: (i: unknown) => mocks.unlock(i), isPending: false }) },
          addDeskOnly: {
            useMutation: () => ({ mutateAsync: (i: unknown) => mocks.add(i), isPending: false }),
          },
          reorder: {
            useMutation: () => ({ mutateAsync: (i: unknown) => mocks.reorder(i), isPending: false }),
          },
          revokeInvite: {
            useMutation: () => ({ mutateAsync: (i: unknown) => mocks.revoke(i), isPending: false }),
          },
          // Never used by the view (U3): a call here would keep the link in the MutationCache.
          invite: { useMutation: (...args: unknown[]) => mocks.inviteUseMutation(...args) },
          resendInvite: { useMutation: (...args: unknown[]) => mocks.resendUseMutation(...args) },
        },
      },
    },
  },
}));

function trpcError(message: string, code = "BAD_REQUEST") {
  return Object.assign(new Error(message), { data: { code } });
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const LINK = "https://booking.example/auth/pridruzi/Tok3nTok3nTok3nTok3nTok3nTok3nTok3nTok3nTok";
const LINK_2 = "https://booking.example/auth/pridruzi/Sec0ndSec0ndSec0ndSec0ndSec0ndSec0ndSec0ndSe";

const answer = (over: Record<string, unknown> = {}) => ({
  inviteId: 90,
  link: LINK,
  mail: "sent",
  expiresDate: "2026-11-23",
  expiresTime: "08:07",
  ...over,
});

let data: WorkersViewData | undefined;
const queryResult = (over: Record<string, unknown> = {}) => ({
  data,
  dataUpdatedAt: 0,
  isPending: data === undefined,
  isFetching: false,
  error: null,
  refetch: mocks.refetch,
  ...over,
});

const clipboard = { writeText: vi.fn() };
let clipboardBefore: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T07:07:00Z"));
  for (const fn of Object.values(mocks)) if (typeof fn === "function") fn.mockReset();
  mocks.lang = "sl";
  // Production's useLocale escapes interpolations (i18next default): every invite string with a name, an address
  // or a date must opt out (React escapes once).
  mocks.escape = true;
  data = WORKERS_VIEW_INVITES;
  mocks.query.mockImplementation(() => queryResult());
  mocks.refetch.mockResolvedValue(undefined);
  for (const fn of [mocks.invalidateList, mocks.invalidateMembers, mocks.invalidateDeskServices]) {
    fn.mockResolvedValue(undefined);
  }
  mocks.invite.mockResolvedValue(answer());
  mocks.resend.mockResolvedValue(answer());
  mocks.revoke.mockResolvedValue({ status: "revoked" });
  clipboard.writeText.mockReset();
  clipboard.writeText.mockResolvedValue(undefined);
  clipboardBefore = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (clipboardBefore) Object.defineProperty(navigator, "clipboard", clipboardBefore);
  else delete (navigator as unknown as Record<string, unknown>).clipboard;
});

const rows = () => screen.getAllByTestId(/^flowko-worker-row-\d+$/);
const row = (id: number) => screen.getByTestId(`flowko-worker-row-${id}`);
const inRow = (id: number) => within(row(id));
const inviteRow = (id: number) => screen.getByTestId(`flowko-invite-row-${id}`);
const inInviteRow = (id: number) => within(inviteRow(id));
const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};
const panel = () => screen.getByTestId("flowko-invite-panel");
const linkField = () => within(panel()).getByLabelText("Povezava za povabilo") as HTMLInputElement;

const withMember = (memberId: number, patch: Record<string, unknown>): WorkersViewData => ({
  members: WORKERS_VIEW_INVITES.members.map((m) => (m.memberId === memberId ? { ...m, ...patch } : m)),
  invites: WORKERS_VIEW_INVITES.invites,
});

describe("Invites: the member list (U1, D1)", () => {
  it("Bor (invited, open): „Povabljen“, valid until Mon 23 Nov 08:07, resend / new link / revoke, no „Povabi“, „Zakleni“ kept", () => {
    render(<WorkersView />);
    const r = inRow(BOR);
    expect(r.getByText("Povabljen")).toBeInTheDocument();
    expect(r.queryByText("Brez prijave")).toBeNull();
    expect(r.getByText("velja do pon., 23. 11. ob 08:07")).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Pošlji znova" })).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Nova povezava" })).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Prekliči povabilo" })).toBeInTheDocument();
    expect(r.queryByRole("button", { name: "Povabi" })).toBeNull();
    expect(r.getByRole("button", { name: "Zakleni" })).toBeInTheDocument();
  });

  it("Gaja (invite expired): „Povabilo je poteklo“ and „poteklo …“, the same three actions", () => {
    render(<WorkersView />);
    const r = inRow(GAJA);
    expect(r.getByText("Povabilo je poteklo")).toBeInTheDocument();
    expect(r.getByText("poteklo ned., 15. 11. ob 17:30")).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Pošlji znova" })).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Nova povezava" })).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Prekliči povabilo" })).toBeInTheDocument();
    expect(r.queryByRole("button", { name: "Povabi" })).toBeNull();
  });

  it("an expiry in another year shows the year", () => {
    data = withMember(BOR, {
      invite: { inviteId: BOR_INVITE, expiresDate: "2027-01-04", expiresTime: "10:00", expired: false },
    });
    render(<WorkersView />);
    expect(inRow(BOR).getByText("velja do pon., 4. 1. 2027 ob 10:00")).toBeInTheDocument();
  });

  it("the row actions are announced with the person's name", () => {
    render(<WorkersView />);
    for (const name of ["Pošlji znova", "Nova povezava", "Prekliči povabilo"]) {
      expect(inRow(BOR).getByRole("button", { name })).toHaveAccessibleDescription("Bor");
    }
  });

  it("a desk-only ACTIVE worker without an invite shows „Povabi“ (described by the name)", () => {
    data = WORKERS_VIEW;
    render(<WorkersView />);
    const button = inRow(BOR).getByRole("button", { name: "Povabi" });
    expect(button).toHaveAccessibleDescription("Bor");
    expect(inRow(BOR).getByText("Brez prijave")).toBeInTheDocument();
  });

  it.each([
    ["Ana (owner)", ANA],
    ["Cene (STAFF without login)", CENE],
    ["Dan (LOCKED)", DAN],
    ["Eva (login)", EVA],
    ["Fran (STAFF with login)", FRAN],
  ])("%s: no „Povabi“", (_label, id) => {
    data = WORKERS_VIEW;
    render(<WorkersView />);
    expect(inRow(id).queryByRole("button", { name: "Povabi" })).toBeNull();
  });

  it("a LOCKED desk-only worker with an invite: „Zaklenjen“, no invite actions, no „Povabi“ (I10)", () => {
    data = withMember(BOR, { status: "LOCKED" });
    render(<WorkersView />);
    const r = inRow(BOR);
    expect(r.getByText("Zaklenjen")).toBeInTheDocument();
    expect(r.queryByText("Povabljen")).toBeNull();
    for (const name of ["Pošlji znova", "Nova povezava", "Prekliči povabilo", "Povabi"]) {
      expect(r.queryByRole("button", { name })).toBeNull();
    }
    expect(r.getByRole("button", { name: "Odkleni" })).toBeInTheDocument();
  });

  it("member rows keep the server order (invite rows are not member rows) and show no e-mail", () => {
    render(<WorkersView />);
    expect(rows().map((r) => r.dataset.testid)).toEqual(
      [ANA, BOR, CENE, DAN, EVA, FRAN, GAJA].map((id) => `flowko-worker-row-${id}`)
    );
    for (const r of rows()) expect(r.innerHTML).not.toMatch(/@/);
  });

  it("move() still sends the member ids only", async () => {
    mocks.reorder.mockResolvedValue({ status: "saved" });
    render(<WorkersView />);
    await click(screen.getByRole("button", { name: "Premakni dol: Bor" }));
    await waitFor(() =>
      expect(mocks.reorder).toHaveBeenCalledWith({ memberIds: [ANA, CENE, BOR, DAN, EVA, FRAN, GAJA] })
    );
  });
});

describe("Invites: „Povabljeni“ (U1)", () => {
  it("is not shown without pending invites", () => {
    data = WORKERS_VIEW;
    render(<WorkersView />);
    expect(screen.queryByText("Povabljeni")).toBeNull();
    expect(screen.queryByTestId(/^flowko-invite-row-/)).toBeNull();
  });

  it("lists each pending invite in its own ul row: name, role, status, e-mail, validity, wrapping", () => {
    render(<WorkersView />);
    expect(screen.getByRole("heading", { name: "Povabljeni" })).toBeInTheDocument();
    const hana = inInviteRow(HANA_INVITE);
    expect(hana.getByText("Hana")).toBeInTheDocument();
    expect(hana.getByText("Delavec")).toBeInTheDocument();
    expect(hana.getByText("Povabljen")).toBeInTheDocument();
    expect(hana.getByText("hana@example.si")).toBeInTheDocument();
    expect(hana.getByText("velja do pet., 20. 11. ob 09:15")).toBeInTheDocument();
    const iva = inInviteRow(IVA_INVITE);
    expect(iva.getByText("Recepcija")).toBeInTheDocument();
    expect(iva.getByText("Povabilo je poteklo")).toBeInTheDocument();
    expect(iva.getByText("iva@example.si")).toBeInTheDocument();
    expect(iva.getByText("poteklo sob., 14. 11. ob 18:00")).toBeInTheDocument();
    for (const id of [HANA_INVITE, IVA_INVITE]) {
      expect(inviteRow(id).tagName).toBe("LI");
      expect(inviteRow(id).closest("ul")).not.toBeNull();
      expect(inviteRow(id).className).toContain("flex-wrap");
      for (const name of ["Pošlji znova", "Nova povezava", "Prekliči povabilo"]) {
        expect(within(inviteRow(id)).getByRole("button", { name })).toBeInTheDocument();
      }
    }
  });

  it("the invite rows sit in their own list, after the member list", () => {
    render(<WorkersView />);
    const memberList = row(ANA).closest("ul");
    const inviteList = inviteRow(HANA_INVITE).closest("ul");
    expect(inviteList).not.toBe(memberList);
    expect(memberList?.compareDocumentPosition(inviteList as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("Invites: the invite form (U2)", () => {
  const form = () => within(screen.getByTestId("flowko-invite-form"));
  const nameField = () => form().getByLabelText("Ime") as HTMLInputElement;
  const emailField = () => form().getByLabelText("E-pošta") as HTMLInputElement;
  const submit = () => click(form().getByRole("button", { name: "Pošlji povabilo" }));
  const fill = (name: string, email: string) => {
    fireEvent.change(nameField(), { target: { value: name } });
    fireEvent.change(emailField(), { target: { value: email } });
  };

  it("has its title and hint, a named role group (Delavec default, Recepcija), each with its hint", () => {
    render(<WorkersView />);
    expect(form().getByText("Povabi s prijavo")).toBeInTheDocument();
    expect(
      form().getByText(
        "Oseba dobi e-pošto s povezavo, s katero si nastavi geslo. Povezava velja 7 dni in deluje enkrat."
      )
    ).toBeInTheDocument();
    expect(form().getByRole("radiogroup", { name: "Vloga" })).toBeInTheDocument();
    expect(form().getByText("Vloga")).toBeVisible();
    expect(form().getByRole("radio", { name: /Delavec/ })).toHaveAttribute("aria-checked", "true");
    expect(form().getByRole("radio", { name: /Recepcija/ })).toHaveAttribute("aria-checked", "false");
    expect(form().getByText("Ima svoj stolpec na koledarju.")).toBeInTheDocument();
    expect(form().getByText("Vnaša termine, nima svojega stolpca.")).toBeInTheDocument();
    expect(emailField()).toHaveAttribute("type", "email");
    expect(emailField()).toHaveAttribute("autocomplete", "off");
    expect(nameField()).toHaveAttribute("maxlength", "80");
  });

  it("sits above „Dodaj brez prijave“", () => {
    render(<WorkersView />);
    const invite = screen.getByTestId("flowko-invite-form");
    const add = screen.getByTestId("flowko-worker-add-form");
    expect(invite.compareDocumentPosition(add)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(invite.className).toContain("border-t");
  });

  it("an empty name: inline, no call", async () => {
    render(<WorkersView />);
    fill("", "hana@example.si");
    await submit();
    expect(form().getByText("Vnesite ime (največ 80 znakov).")).toBeInTheDocument();
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it.each(["hana", "hana@", "x@flowko.invalid", "x@sms.cal.com", ""])(
    "a bad e-mail (%j): inline, no call",
    async (email) => {
      render(<WorkersView />);
      fill("Hana", email);
      await submit();
      const text = "Vnesite veljaven e-poštni naslov.";
      expect(form().getByText(text)).toBeInTheDocument();
      expect(emailField()).toHaveAttribute("aria-invalid", "true");
      expect(emailField()).toHaveAccessibleDescription(text);
      expect(mocks.invite).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["email_has_login", "Ta e-pošta že ima račun Flowko."],
    ["invite_pending", "Za to e-pošto povabilo že čaka. Uporabite „Pošlji znova“ ali „Nova povezava“."],
    ["invite_bad_email", "Vnesite veljaven e-poštni naslov."],
  ])(
    "%s: inline on the e-mail field, aria-invalid + description, values kept, no toast",
    async (code, text) => {
      mocks.invite.mockRejectedValue(trpcError(code));
      render(<WorkersView />);
      fill("Hana", "hana@example.si");
      await submit();
      expect(await form().findByText(text)).toBeInTheDocument();
      expect(emailField()).toHaveAttribute("aria-invalid", "true");
      expect(emailField()).toHaveAccessibleDescription(text);
      expect(nameField().value).toBe("Hana");
      expect(emailField().value).toBe("hana@example.si");
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(screen.queryByTestId("flowko-invite-panel")).toBeNull();
    }
  );

  it.each([
    ["member_name_taken", "V podjetju je že oseba s tem imenom."],
    ["bad_member", "Vnesite ime (največ 80 znakov)."],
  ])("%s: inline on the name field, values kept", async (code, text) => {
    mocks.invite.mockRejectedValue(trpcError(code));
    render(<WorkersView />);
    fill("Bor", "bor@example.si");
    await submit();
    expect(await form().findByText(text)).toBeInTheDocument();
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(nameField()).toHaveAccessibleDescription(text);
    expect(nameField().value).toBe("Bor");
  });

  it.each([
    ["forbidden", "BAD_REQUEST", "Za to nimate dovoljenja."],
    ["member_conflict", "BAD_REQUEST", "Hkrati je shranjeval še nekdo. Poskusite znova."],
    ["Too many", "TOO_MANY_REQUESTS", "Preveč zahtev. Poskusite znova čez trenutek."],
    ["boom", "INTERNAL_SERVER_ERROR", "Nekaj je šlo narobe."],
  ])("%s (%s): toast %s, values kept", async (message, code, text) => {
    mocks.invite.mockRejectedValue(trpcError(message, code));
    render(<WorkersView />);
    fill("Hana", "hana@example.si");
    await submit();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(text, "error"));
    expect(nameField().value).toBe("Hana");
  });

  it("success (WORKER, mail sent): trimmed values through the vanilla client, the panel, the C10 hint, cleared form, refreshed list", async () => {
    render(<WorkersView />);
    fill("  Hana  ", " Hana@Example.SI ");
    await submit();
    await waitFor(() =>
      expect(mocks.invite).toHaveBeenCalledWith({
        kind: "new",
        name: "Hana",
        email: "hana@example.si",
        role: "WORKER",
      })
    );
    expect(mocks.inviteUseMutation).not.toHaveBeenCalled();
    expect(await screen.findByTestId("flowko-invite-panel")).toBeInTheDocument();
    expect(within(panel()).getByText("Povabilo: Hana")).toBeInTheDocument();
    expect(linkField().value).toBe(LINK);
    expect(within(panel()).getByText("Povabilo je poslano na hana@example.si.")).toBeInTheDocument();
    expect(
      within(panel()).getByText(
        "Ko oseba sprejme povabilo, dobi vaš običajni teden. Storitve ji dodelite v Storitvah, ko se pridruži."
      )
    ).toBeInTheDocument();
    expect(
      within(panel()).getByText("Povezavo vidite samo zdaj. Pozneje lahko ustvarite novo.")
    ).toBeInTheDocument();
    await waitFor(() => expect(nameField().value).toBe(""));
    expect(emailField().value).toBe("");
    expect(mocks.invalidateList).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
    expect(mocks.invalidateMembers).toHaveBeenCalled();
  });

  it("the form is cleared only after the refresh came back", async () => {
    const refresh = deferred();
    mocks.invalidateList.mockReturnValue(refresh.promise);
    render(<WorkersView />);
    fill("Hana", "hana@example.si");
    await submit();
    await waitFor(() => expect(mocks.invalidateList).toHaveBeenCalled());
    expect(nameField().value).toBe("Hana");
    await act(async () => {
      refresh.resolve();
    });
    await waitFor(() => expect(nameField().value).toBe(""));
  });

  it("STAFF: role STAFF is sent and the panel has no C10 hint", async () => {
    render(<WorkersView />);
    fill("Iva", "iva@example.si");
    await click(form().getByRole("radio", { name: /Recepcija/ }));
    await submit();
    await waitFor(() =>
      expect(mocks.invite).toHaveBeenCalledWith({
        kind: "new",
        name: "Iva",
        email: "iva@example.si",
        role: "STAFF",
      })
    );
    await screen.findByTestId("flowko-invite-panel");
    expect(within(panel()).queryByText(/običajni teden/)).toBeNull();
    expect(within(panel()).queryByText(/ostanejo, kot so/)).toBeNull();
  });

  it("mail not sent: the warning line instead of the sent line", async () => {
    mocks.invite.mockResolvedValue(answer({ mail: "not_sent" }));
    render(<WorkersView />);
    fill("Hana", "hana@example.si");
    await submit();
    await screen.findByTestId("flowko-invite-panel");
    expect(
      within(panel()).getByText(
        "Povabila po e-pošti ni bilo mogoče poslati. Kopirajte povezavo in jo pošljite sami."
      )
    ).toBeInTheDocument();
    expect(within(panel()).queryByText(/je poslano na/)).toBeNull();
    expect(linkField().value).toBe(LINK);
    // UI-5: the focused title carries the lines as its description, so a screen reader hears the warning.
    const title = within(panel()).getByRole("heading", { name: "Povabilo: Hana" });
    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveAccessibleDescription(
      expect.stringContaining(
        "Povabila po e-pošti ni bilo mogoče poslati. Kopirajte povezavo in jo pošljite sami."
      )
    );
  });

  it("a second click while the invite runs sends once", async () => {
    const pending = deferred<ReturnType<typeof answer>>();
    mocks.invite.mockReturnValue(pending.promise);
    render(<WorkersView />);
    fill("Hana", "hana@example.si");
    await submit();
    await submit();
    expect(mocks.invite).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(answer());
    });
  });
});

describe("Invites: the link panel (U3)", () => {
  async function openPanel(link = LINK, name = "Hana") {
    mocks.invite.mockResolvedValueOnce(answer({ link }));
    const form = within(screen.getByTestId("flowko-invite-form"));
    fireEvent.change(form.getByLabelText("Ime"), { target: { value: name } });
    fireEvent.change(form.getByLabelText("E-pošta"), { target: { value: "hana@example.si" } });
    await click(form.getByRole("button", { name: "Pošlji povabilo" }));
    await screen.findByTestId("flowko-invite-panel");
  }

  it("the panel takes the focus (its title) and the link field is read-only, selectable and not disabled", async () => {
    render(<WorkersView />);
    await openPanel();
    await waitFor(() => expect(within(panel()).getByText("Povabilo: Hana")).toHaveFocus());
    expect(linkField()).toHaveAttribute("readonly");
    expect(linkField()).not.toBeDisabled();
  });

  it("„Kopiraj povezavo“ writes the link once on the click and says so", async () => {
    render(<WorkersView />);
    await openPanel();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    await click(within(panel()).getByRole("button", { name: "Kopiraj povezavo" }));
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith(LINK);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Povezava je kopirana.", "success"));
  });

  it("a refused copy says so and the field stays there to copy by hand", async () => {
    clipboard.writeText.mockRejectedValue(new Error("NotAllowedError"));
    render(<WorkersView />);
    await openPanel();
    await click(within(panel()).getByRole("button", { name: "Kopiraj povezavo" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Kopiranje ni uspelo. Označite povezavo in jo kopirajte ročno.",
        "error"
      )
    );
    expect(linkField().value).toBe(LINK);
  });

  it("no clipboard (insecure context): the failure text, nothing logged", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<WorkersView />);
    await openPanel();
    await click(within(panel()).getByRole("button", { name: "Kopiraj povezavo" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Kopiranje ni uspelo. Označite povezavo in jo kopirajte ročno.",
        "error"
      )
    );
  });

  it("the link never reaches the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined)
    );
    try {
      clipboard.writeText.mockRejectedValueOnce(new Error("NotAllowedError"));
      render(<WorkersView />);
      await openPanel();
      await click(within(panel()).getByRole("button", { name: "Kopiraj povezavo" }));
      await click(within(panel()).getByRole("button", { name: "Kopiraj povezavo" }));
      for (const spy of spies) {
        for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("Tok3n");
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("„Zapri“ removes the link from the page", async () => {
    const { container } = render(<WorkersView />);
    await openPanel();
    await click(within(panel()).getByRole("button", { name: "Zapri" }));
    expect(screen.queryByTestId("flowko-invite-panel")).toBeNull();
    expect(container.innerHTML).not.toContain("Tok3n");
  });

  it("a second panel replaces the first", async () => {
    const { container } = render(<WorkersView />);
    await openPanel(LINK, "Hana");
    await openPanel(LINK_2, "Jana");
    expect(screen.getAllByTestId("flowko-invite-panel")).toHaveLength(1);
    expect(within(panel()).getByText("Povabilo: Jana")).toBeInTheDocument();
    expect(linkField().value).toBe(LINK_2);
    expect(container.innerHTML).not.toContain("Tok3n");
  });

  it("the link is gone after the page unmounts and comes back without a panel", async () => {
    const { unmount } = render(<WorkersView />);
    await openPanel();
    unmount();
    render(<WorkersView />);
    expect(screen.queryByTestId("flowko-invite-panel")).toBeNull();
  });
});

describe("Invites: row actions (D1, U3, U4)", () => {
  const dialog = () => screen.getByRole("dialog");

  it("„Povabi“ on a desk-only row: a dialog with the e-mail field focused; submit invites that member", async () => {
    data = WORKERS_VIEW;
    render(<WorkersView />);
    await click(inRow(BOR).getByRole("button", { name: "Povabi" }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    expect(within(dialog()).getByText("Povabi: Bor")).toBeInTheDocument();
    expect(
      within(dialog()).getByText(
        "Vpišite e-pošto. Bor dobi povezavo za prijavo; stolpec, urnik, termini in storitve ostanejo."
      )
    ).toBeInTheDocument();
    const email = within(dialog()).getByLabelText("E-pošta") as HTMLInputElement;
    await waitFor(() => expect(email).toHaveFocus());
    fireEvent.change(email, { target: { value: " Bor@Example.si " } });
    await click(within(dialog()).getByRole("button", { name: "Pošlji povabilo" }));
    await waitFor(() =>
      expect(mocks.invite).toHaveBeenCalledWith({ kind: "member", memberId: BOR, email: "bor@example.si" })
    );
    expect(mocks.inviteUseMutation).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(panel()).getByText("Povabilo: Bor")).toBeInTheDocument();
    expect(within(panel()).getByText("Povabilo je poslano na bor@example.si.")).toBeInTheDocument();
    expect(
      within(panel()).getByText("Stolpec, urnik, termini in storitve ostanejo, kot so.")
    ).toBeInTheDocument();
    expect(within(panel()).queryByText(/običajni teden/)).toBeNull();
    expect(mocks.invalidateList).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
  });

  it("the dialog checks the e-mail before sending", async () => {
    data = WORKERS_VIEW;
    render(<WorkersView />);
    await click(inRow(BOR).getByRole("button", { name: "Povabi" }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    const email = within(dialog()).getByLabelText("E-pošta");
    fireEvent.change(email, { target: { value: "desk-1@flowko.invalid" } });
    await click(within(dialog()).getByRole("button", { name: "Pošlji povabilo" }));
    expect(within(dialog()).getByText("Vnesite veljaven e-poštni naslov.")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it.each([
    ["email_has_login", "Ta e-pošta že ima račun Flowko."],
    ["invite_pending", "Za to e-pošto povabilo že čaka. Uporabite „Pošlji znova“ ali „Nova povezava“."],
  ])("dialog: %s stays inline, the dialog stays open, the value is kept", async (code, text) => {
    data = WORKERS_VIEW;
    mocks.invite.mockRejectedValue(trpcError(code));
    render(<WorkersView />);
    await click(inRow(BOR).getByRole("button", { name: "Povabi" }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    const email = within(dialog()).getByLabelText("E-pošta") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "bor@example.si" } });
    await click(within(dialog()).getByRole("button", { name: "Pošlji povabilo" }));
    expect(await within(dialog()).findByText(text)).toBeInTheDocument();
    expect(email).toHaveAccessibleDescription(text);
    expect(email.value).toBe("bor@example.si");
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("dialog: member_not_desk_only closes it, says so and refreshes", async () => {
    data = WORKERS_VIEW;
    mocks.invite.mockRejectedValue(trpcError("member_not_desk_only"));
    render(<WorkersView />);
    await click(inRow(BOR).getByRole("button", { name: "Povabi" }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    fireEvent.change(within(dialog()).getByLabelText("E-pošta"), { target: { value: "bor@example.si" } });
    await click(within(dialog()).getByRole("button", { name: "Pošlji povabilo" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Te osebe ni več mogoče povabiti. Seznam je osvežen.", "error")
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.invalidateList).toHaveBeenCalled();
  });

  it("„Prekliči“ closes the dialog without a call", async () => {
    data = WORKERS_VIEW;
    render(<WorkersView />);
    await click(inRow(BOR).getByRole("button", { name: "Povabi" }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    await click(within(dialog()).getByRole("button", { name: "Prekliči" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it("„Pošlji znova“ on a pending invite: sendMail true, the panel says the new invite went to that address", async () => {
    mocks.resend.mockResolvedValue(answer({ inviteId: HANA_INVITE }));
    render(<WorkersView />);
    await click(inInviteRow(HANA_INVITE).getByRole("button", { name: "Pošlji znova" }));
    await waitFor(() => expect(mocks.resend).toHaveBeenCalledWith({ inviteId: HANA_INVITE, sendMail: true }));
    expect(mocks.resendUseMutation).not.toHaveBeenCalled();
    await screen.findByTestId("flowko-invite-panel");
    expect(within(panel()).getByText("Povabilo: Hana")).toBeInTheDocument();
    expect(
      within(panel()).getByText(
        "Novo povabilo je poslano na hana@example.si. Prejšnja povezava ne deluje več."
      )
    ).toBeInTheDocument();
    expect(linkField().value).toBe(LINK);
    expect(
      within(panel()).getByText(
        "Ko oseba sprejme povabilo, dobi vaš običajni teden. Storitve ji dodelite v Storitvah, ko se pridruži."
      )
    ).toBeInTheDocument();
    expect(mocks.invalidateList).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
  });

  it("„Pošlji znova“ on a desk-only member's invite (no address on the page): mail sent + the old link is dead", async () => {
    mocks.resend.mockResolvedValue(answer({ inviteId: BOR_INVITE }));
    render(<WorkersView />);
    await click(inRow(BOR).getByRole("button", { name: "Pošlji znova" }));
    await waitFor(() => expect(mocks.resend).toHaveBeenCalledWith({ inviteId: BOR_INVITE, sendMail: true }));
    await screen.findByTestId("flowko-invite-panel");
    expect(within(panel()).getByText("Povabilo: Bor")).toBeInTheDocument();
    expect(within(panel()).getByText("E-pošta je bila poslana")).toBeInTheDocument();
    expect(
      within(panel()).getByText("Nova povezava je pripravljena. Prejšnja ne deluje več.")
    ).toBeInTheDocument();
    expect(
      within(panel()).getByText("Stolpec, urnik, termini in storitve ostanejo, kot so.")
    ).toBeInTheDocument();
    expect(panel().innerHTML).not.toMatch(/@/);
  });

  it("„Pošlji znova“ whose mail failed: the new-link line and the warning", async () => {
    mocks.resend.mockResolvedValue(answer({ inviteId: HANA_INVITE, mail: "not_sent" }));
    render(<WorkersView />);
    await click(inInviteRow(HANA_INVITE).getByRole("button", { name: "Pošlji znova" }));
    await screen.findByTestId("flowko-invite-panel");
    expect(
      within(panel()).getByText("Nova povezava je pripravljena. Prejšnja ne deluje več.")
    ).toBeInTheDocument();
    expect(
      within(panel()).getByText(
        "Povabila po e-pošti ni bilo mogoče poslati. Kopirajte povezavo in jo pošljite sami."
      )
    ).toBeInTheDocument();
    expect(within(panel()).queryByText(/je poslano na/)).toBeNull();
  });

  it("„Nova povezava“: sendMail false, the new-link line, no mail line, no C10 hint for STAFF", async () => {
    mocks.resend.mockResolvedValue(answer({ inviteId: IVA_INVITE, mail: "skipped" }));
    render(<WorkersView />);
    await click(inInviteRow(IVA_INVITE).getByRole("button", { name: "Nova povezava" }));
    await waitFor(() => expect(mocks.resend).toHaveBeenCalledWith({ inviteId: IVA_INVITE, sendMail: false }));
    await screen.findByTestId("flowko-invite-panel");
    expect(within(panel()).getByText("Povabilo: Iva")).toBeInTheDocument();
    expect(
      within(panel()).getByText("Nova povezava je pripravljena. Prejšnja ne deluje več.")
    ).toBeInTheDocument();
    expect(within(panel()).queryByText(/poslan/)).toBeNull();
    expect(within(panel()).queryByText(/ni bilo mogoče poslati/)).toBeNull();
    expect(within(panel()).queryByText(/običajni teden/)).toBeNull();
    expect(linkField().value).toBe(LINK);
  });

  it("„Nova povezava“ on a desk-only member's invite (Gaja, expired)", async () => {
    mocks.resend.mockResolvedValue(answer({ inviteId: GAJA_INVITE, mail: "skipped" }));
    render(<WorkersView />);
    await click(inRow(GAJA).getByRole("button", { name: "Nova povezava" }));
    await waitFor(() =>
      expect(mocks.resend).toHaveBeenCalledWith({ inviteId: GAJA_INVITE, sendMail: false })
    );
    await screen.findByTestId("flowko-invite-panel");
    expect(within(panel()).getByText("Povabilo: Gaja")).toBeInTheDocument();
    expect(
      within(panel()).getByText("Stolpec, urnik, termini in storitve ostanejo, kot so.")
    ).toBeInTheDocument();
  });

  it("„Prekliči povabilo“: no dialog, revokes, toasts, refreshes", async () => {
    render(<WorkersView />);
    await click(inInviteRow(HANA_INVITE).getByRole("button", { name: "Prekliči povabilo" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith({ inviteId: HANA_INVITE }));
    expect(mocks.toast).toHaveBeenCalledWith("Povabilo je preklicano: Hana", "success");
    expect(mocks.invalidateList).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
  });

  it("revoking a desk-only member's invite names the member", async () => {
    render(<WorkersView />);
    await click(inRow(BOR).getByRole("button", { name: "Prekliči povabilo" }));
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith({ inviteId: BOR_INVITE }));
    expect(mocks.toast).toHaveBeenCalledWith("Povabilo je preklicano: Bor", "success");
  });

  it("revoking the invite whose link is on screen closes the panel (that link is dead)", async () => {
    mocks.resend.mockResolvedValue(answer({ inviteId: HANA_INVITE }));
    render(<WorkersView />);
    await click(inInviteRow(HANA_INVITE).getByRole("button", { name: "Nova povezava" }));
    await screen.findByTestId("flowko-invite-panel");
    await click(inInviteRow(HANA_INVITE).getByRole("button", { name: "Prekliči povabilo" }));
    await waitFor(() => expect(screen.queryByTestId("flowko-invite-panel")).toBeNull());
  });

  it("revoking another invite keeps the panel", async () => {
    mocks.resend.mockResolvedValue(answer({ inviteId: HANA_INVITE }));
    render(<WorkersView />);
    await click(inInviteRow(HANA_INVITE).getByRole("button", { name: "Nova povezava" }));
    await screen.findByTestId("flowko-invite-panel");
    await click(inInviteRow(IVA_INVITE).getByRole("button", { name: "Prekliči povabilo" }));
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalled());
    expect(screen.getByTestId("flowko-invite-panel")).toBeInTheDocument();
  });

  it.each([
    ["invite_gone", "Tega povabila ni več (sprejeto ali preklicano). Seznam je osvežen."],
    ["member_not_desk_only", "Te osebe ni več mogoče povabiti. Seznam je osvežen."],
  ])("resend %s: its text and a refresh, no panel", async (code, text) => {
    mocks.resend.mockRejectedValue(trpcError(code));
    render(<WorkersView />);
    await click(inRow(BOR).getByRole("button", { name: "Pošlji znova" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(text, "error"));
    expect(mocks.invalidateList).toHaveBeenCalled();
    expect(screen.queryByTestId("flowko-invite-panel")).toBeNull();
  });

  it.each([
    ["invite_gone", "Tega povabila ni več (sprejeto ali preklicano). Seznam je osvežen."],
    ["member_not_desk_only", "Te osebe ni več mogoče povabiti. Seznam je osvežen."],
  ])("revoke %s: its text and a refresh", async (code, text) => {
    mocks.revoke.mockRejectedValue(trpcError(code));
    render(<WorkersView />);
    await click(inInviteRow(HANA_INVITE).getByRole("button", { name: "Prekliči povabilo" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(text, "error"));
    expect(mocks.invalidateList).toHaveBeenCalled();
  });

  it.each([
    ["email_has_login", "BAD_REQUEST", "Ta e-pošta že ima račun Flowko."],
    ["forbidden", "FORBIDDEN", "Za to nimate dovoljenja."],
    ["Too many", "TOO_MANY_REQUESTS", "Preveč zahtev. Poskusite znova čez trenutek."],
    ["boom", "INTERNAL_SERVER_ERROR", "Nekaj je šlo narobe."],
  ])("resend error %s (%s) -> toast, no refresh", async (message, code, text) => {
    mocks.resend.mockRejectedValue(trpcError(message, code));
    render(<WorkersView />);
    await click(inInviteRow(HANA_INVITE).getByRole("button", { name: "Pošlji znova" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(text, "error"));
    expect(mocks.invalidateList).not.toHaveBeenCalled();
  });

  it("one write at a time: a double click sends once and every action is off meanwhile", async () => {
    const pending = deferred<ReturnType<typeof answer>>();
    mocks.resend.mockReturnValue(pending.promise);
    render(<WorkersView />);
    const button = inInviteRow(HANA_INVITE).getByRole("button", { name: "Pošlji znova" });
    await click(button);
    await click(button);
    expect(mocks.resend).toHaveBeenCalledTimes(1);
    expect(inRow(BOR).getByRole("button", { name: "Prekliči povabilo" })).toBeDisabled();
    expect(inInviteRow(IVA_INVITE).getByRole("button", { name: "Nova povezava" })).toBeDisabled();
    expect(inRow(EVA).getByRole("button", { name: "Zakleni" })).toBeDisabled();
    await act(async () => {
      pending.resolve(answer({ inviteId: HANA_INVITE }));
    });
    await waitFor(() =>
      expect(inInviteRow(IVA_INVITE).getByRole("button", { name: "Nova povezava" })).toBeEnabled()
    );
  });
});

describe("Invites: names are not escaped twice", () => {
  const AMP: WorkersViewData = {
    members: WORKERS_VIEW.members,
    invites: [
      {
        inviteId: 81,
        name: "Ana & Maja",
        email: "ana.maja@example.si",
        role: "WORKER",
        expiresDate: "2026-11-23",
        expiresTime: "08:07",
        expired: false,
      },
    ],
  };

  beforeEach(() => {
    data = AMP;
  });

  it("the panel title after a resend and the revoke toast", async () => {
    mocks.resend.mockResolvedValue(answer({ inviteId: 81 }));
    render(<WorkersView />);
    await click(inInviteRow(81).getByRole("button", { name: "Pošlji znova" }));
    await screen.findByTestId("flowko-invite-panel");
    expect(within(panel()).getByText("Povabilo: Ana & Maja")).toBeInTheDocument();
    expect(panel().textContent).not.toContain("&amp;");
    await click(inInviteRow(81).getByRole("button", { name: "Prekliči povabilo" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Povabilo je preklicano: Ana & Maja", "success")
    );
  });

  it("the panel after a create from the form", async () => {
    render(<WorkersView />);
    const form = within(screen.getByTestId("flowko-invite-form"));
    fireEvent.change(form.getByLabelText("Ime"), { target: { value: "Tim & Tea" } });
    fireEvent.change(form.getByLabelText("E-pošta"), { target: { value: "tim@example.si" } });
    await click(form.getByRole("button", { name: "Pošlji povabilo" }));
    await screen.findByTestId("flowko-invite-panel");
    expect(within(panel()).getByText("Povabilo: Tim & Tea")).toBeInTheDocument();
    expect(panel().textContent).not.toContain("&amp;");
  });

  it("the „Povabi“ dialog of a member named with „&“", async () => {
    data = {
      members: WORKERS_VIEW.members.map((m) => (m.memberId === BOR ? { ...m, displayName: "Bor & Co" } : m)),
      invites: [],
    };
    render(<WorkersView />);
    await click(inRow(BOR).getByRole("button", { name: "Povabi" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(within(screen.getByRole("dialog")).getByText("Povabi: Bor & Co")).toBeInTheDocument();
    expect(screen.getByRole("dialog").textContent).not.toContain("&amp;");
  });
});

describe("Invites: English", () => {
  it("the row and the pending list in English", () => {
    mocks.lang = "en";
    render(<WorkersView />);
    expect(inRow(BOR).getByText("Invited")).toBeInTheDocument();
    expect(inRow(BOR).getByText(/^valid until Mon, 11\/23 at 08:07$/)).toBeInTheDocument();
    expect(inRow(GAJA).getByText("Invite expired")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Invited" })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("flowko-invite-form")).getByText("Invite with a login")
    ).toBeInTheDocument();
  });
});
