// Flowko U29e (Task 11, E10.6, RIGHTS-1): a 409 signed_in answer shows the already-signed-in view (no form, no
// password left in the DOM, no sign-in, no toast); a name with an invisible or control character shows its own
// inline text before any POST.
// Flowko U29d (Task 8, A5, A7): the accept form. The e-mail is fixed (read-only), the name is prefilled and
// editable, the password shows Cal's live hints (caplow / min / num) and must be repeated. Submit posts
// {token, name, password, csrfToken} to /api/flowko/pridruzi; on 201 it signs in with the credentials provider and
// makes a full load of /koledar; if that sign-in fails the account exists and the invite is used, so the page says
// so and links to the login, never posting the token again. Every answer and every fetch failure is shown in
// Slovene (never a raw message, never a toast), and a fresh CSRF token is fetched after every failed POST.
import { WEBAPP_URL, WEBSITE_PRIVACY_POLICY_URL } from "@calcom/lib/constants";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeT } from "../flowko-settings/settings.fixture";
import AcceptView from "./accept-view";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  toast: vi.fn(),
  assign: vi.fn(),
  posts: [] as { status: number; body: unknown; throws?: boolean; badJson?: boolean }[],
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl", exists: () => false }, isLocaleReady: true }),
}));
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => mocks.signIn(...args) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => mocks.toast(...args) }));

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const EMAIL = "hana@example.si";
const PASSWORD = "Geslo123";
const CALLBACK = `${WEBAPP_URL}/koledar`;

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[] = [];
let csrfRound = 0;

function fakeFetch(url: string, init?: RequestInit) {
  calls.push({ url, init });
  if (url === "/api/csrf") {
    csrfRound += 1;
    const token = `csrf-${csrfRound}`;
    return Promise.resolve({ status: 200, ok: true, json: async () => ({ csrfToken: token }) });
  }
  const next = mocks.posts.shift() ?? { status: 201, body: {} };
  if (next.throws) return Promise.reject(new TypeError("Failed to fetch"));
  return Promise.resolve({
    status: next.status,
    ok: next.status >= 200 && next.status < 300,
    json: async () => {
      if (next.badJson) throw new SyntaxError("Unexpected token < in JSON");
      return next.body;
    },
  });
}

const csrfCalls = () => calls.filter((c) => c.url === "/api/csrf").length;
const posts = () => calls.filter((c) => c.url === "/api/flowko/pridruzi");

function view() {
  // the root layout provides the TooltipProvider Cal's PasswordField needs
  return (
    <TooltipProvider>
      <AcceptView
        token={TOKEN}
        email={EMAIL}
        name="Hana"
        title="Pridružite se salonu Flowko Test"
        privacy="Upravljavec vaših podatkov je salon Flowko Test, Flowko pa je njegov obdelovalec."
      />
    </TooltipProvider>
  );
}

function renderView() {
  return render(view());
}

const passwordInput = () => screen.getByLabelText("Geslo") as HTMLInputElement;
const confirmInput = () => screen.getByLabelText("Potrdi geslo") as HTMLInputElement;
const nameInput = () => screen.getByLabelText("Ime") as HTMLInputElement;

async function fill(password = PASSWORD, confirm = password, name?: string) {
  if (name !== undefined) fireEvent.change(nameInput(), { target: { value: name } });
  fireEvent.change(passwordInput(), { target: { value: password } });
  fireEvent.change(confirmInput(), { target: { value: confirm } });
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Pridruži se" }));
  });
}

async function ready() {
  renderView();
  await waitFor(() => expect(csrfCalls()).toBe(1));
}

const alertText = () => screen.getByTestId("flowko-invite-accept-error").textContent;

describe("AcceptView (Flowko U29d A5, A7)", () => {
  beforeEach(() => {
    calls = [];
    csrfRound = 0;
    mocks.posts = [];
    mocks.signIn.mockReset().mockResolvedValue({ ok: true, error: null, status: 200, url: CALLBACK });
    mocks.toast.mockReset();
    mocks.assign.mockReset();
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    vi.stubGlobal("location", { ...window.location, assign: mocks.assign });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the heading, the fixed e-mail with the contact line, the prefilled name and the privacy line", async () => {
    await ready();
    expect(screen.getByRole("heading", { name: "Pridružite se salonu Flowko Test" })).toBeTruthy();
    const email = screen.getByLabelText("E-pošta") as HTMLInputElement;
    expect(email.value).toBe(EMAIL);
    expect(email.readOnly).toBe(true);
    expect(email.disabled).toBe(false);
    expect(screen.getByTestId("flowko-invite-email-hint").textContent).toBe(
      "E-poštnega naslova ni mogoče spremeniti. Če ni pravi, se obrnite na salon."
    );
    expect(nameInput().value).toBe("Hana");
    expect(nameInput().maxLength).toBe(80);
    expect(screen.getByTestId("flowko-invite-privacy").textContent).toBe(
      "Upravljavec vaših podatkov je salon Flowko Test, Flowko pa je njegov obdelovalec. Obvestilo o zasebnosti"
    );
    const link = screen.getByRole("link", { name: "Obvestilo o zasebnosti" });
    expect(link.getAttribute("href")).toBe(WEBSITE_PRIVACY_POLICY_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(passwordInput().getAttribute("autocomplete")).toBe("new-password");
  });

  it("UI-3: the server HTML posts natively (never a GET with the password) and its submit is disabled until hydration", async () => {
    const html = renderToString(view());
    const doc = new DOMParser().parseFromString(html, "text/html");
    const form = doc.querySelector('[data-testid="flowko-invite-accept-form"]') as HTMLFormElement;
    expect(form.getAttribute("method")).toBe("post");
    const button = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    // After the mount (hydration) the button is enabled.
    await ready();
    expect((screen.getByRole("button", { name: "Pridruži se" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("fetches a CSRF token on mount, without the browser cache", async () => {
    await ready();
    expect(calls[0]).toEqual({ url: "/api/csrf", init: { cache: "no-store" } });
  });

  it("shows the three password hints live: unmet for „abc“, all met for a good password", async () => {
    await ready();
    const hint = (text: string) => screen.getByText(text).closest("li") as HTMLElement;
    fireEvent.change(passwordInput(), { target: { value: "abc" } });
    await waitFor(() => expect(hint("Najmanj 7 znakov").className).not.toContain("text-green-600"));
    expect(hint("Mešanica velikih in malih črk").className).not.toContain("text-green-600");
    expect(hint("Vsebuje vsaj 1 številko").className).not.toContain("text-green-600");

    fireEvent.change(passwordInput(), { target: { value: PASSWORD } });
    await waitFor(() => expect(hint("Najmanj 7 znakov").className).toContain("text-green-600"));
    expect(hint("Mešanica velikih in malih črk").className).toContain("text-green-600");
    expect(hint("Vsebuje vsaj 1 številko").className).toContain("text-green-600");
  });

  it("refuses a weak password and a mismatch on the page, without a POST", async () => {
    await ready();
    await fill("abc");
    await submit();
    expect(posts()).toHaveLength(0);

    await fill(PASSWORD, "Geslo124");
    await submit();
    expect(await screen.findByText("Gesli se ne ujemata.")).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it("refuses an empty name and one over 80 characters on the page, without a POST", async () => {
    await ready();
    await fill(PASSWORD, PASSWORD, "   ");
    await submit();
    expect(await screen.findByText("Vnesite ime (največ 80 znakov).")).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it("Flowko U29e (RIGHTS-1): a name with an invisible or control character shows the characters text on the page, without a POST", async () => {
    // code points are built, never typed as invisible characters
    const zwsp = String.fromCharCode(0x200b);
    const nul = String.fromCharCode(0);
    const rlo = String.fromCharCode(0x202e);
    await ready();
    for (const name of [`Ana${zwsp}`, `Ana${nul}`, `An${rlo}a`]) {
      await fill(PASSWORD, PASSWORD, name);
      await submit();
      expect(
        await screen.findByText("Ime vsebuje nedovoljene nevidne znake. Vnesite ga znova.")
      ).toBeTruthy();
      expect(screen.queryByText("Vnesite ime (največ 80 znakov).")).toBeNull();
      expect(posts()).toHaveLength(0);
    }
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    // the next valid name goes through (the inline text clears on typing)
    await fill(PASSWORD, PASSWORD, "Ana Novak");
    await submit();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String(posts()[0].init?.body)).name).toBe("Ana Novak");
  });

  it("refuses a password over 72 UTF-8 bytes on the page, without a POST", async () => {
    await ready();
    const long = `Aa1${"ž".repeat(35)}`;
    await fill(long);
    await submit();
    expect(await screen.findByText("Geslo je predolgo.")).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it("posts {token, name, password, csrfToken} as JSON, then signs in and makes a full load of /koledar", async () => {
    await ready();
    await fill(PASSWORD, PASSWORD, "  Hana Nova ");
    await submit();

    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith(CALLBACK));
    expect(posts()).toHaveLength(1);
    const { init } = posts()[0];
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      token: TOKEN,
      name: "  Hana Nova ",
      password: PASSWORD,
      csrfToken: "csrf-1",
    });
    expect(mocks.signIn).toHaveBeenCalledWith("credentials", {
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: CALLBACK,
      redirect: false,
    });
    expect(mocks.assign).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "an error answer",
      () => mocks.signIn.mockResolvedValue({ ok: false, error: "rate limited", status: 429 }),
    ],
    ["no answer", () => mocks.signIn.mockResolvedValue(undefined)],
    ["a throw", () => mocks.signIn.mockRejectedValue(new Error("network"))],
  ])(
    "a sign-in that fails after the accept (%s) says the account exists and links to the login, no second POST",
    async (_l, arrange) => {
      arrange();
      await ready();
      await fill();
      await submit();

      expect(await screen.findByText("Račun je ustvarjen. Prijavite se z e-pošto in geslom.")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Prijava" }).getAttribute("href")).toBe("/auth/login");
      expect(screen.queryByRole("button", { name: "Pridruži se" })).toBeNull();
      expect(mocks.assign).not.toHaveBeenCalled();
      expect(posts()).toHaveLength(1);
      expect(mocks.toast).not.toHaveBeenCalled();
    }
  );

  it("invite_invalid switches to the invalid view (no form, no names)", async () => {
    mocks.posts.push({ status: 400, body: { code: "invite_invalid" } });
    await ready();
    await fill();
    await submit();

    expect(await screen.findByText("Povezava ne deluje")).toBeTruthy();
    expect(screen.getByTestId("flowko-invite-invalid").textContent).toBe(
      "Povezava je potekla, je bila že uporabljena ali je bila preklicana. Za novo se obrnite na salon."
    );
    expect(screen.queryByRole("button", { name: "Pridruži se" })).toBeNull();
    expect(document.body.textContent).not.toContain("Flowko Test");
    expect(document.body.textContent).not.toContain(EMAIL);
  });

  it("email_has_login shows the text and the contact line", async () => {
    mocks.posts.push({ status: 400, body: { code: "email_has_login" } });
    await ready();
    await fill();
    await submit();

    await waitFor(() =>
      expect(alertText()).toBe("Račun Flowko s tem e-poštnim naslovom že obstaja. Obrnite se na salon.")
    );
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it.each([
    ["member_name_taken", "V salonu je že oseba s tem imenom. Vnesite drugačno ime."],
    ["bad_member", "Vnesite ime (največ 80 znakov)."],
  ])("%s is shown inline on the name field, the values kept", async (code, text) => {
    mocks.posts.push({ status: 400, body: { code } });
    await ready();
    await fill(PASSWORD, PASSWORD, "Mojca");
    await submit();

    const message = await screen.findByText(text);
    expect(nameInput().closest("div")?.parentElement?.contains(message)).toBe(true);
    expect(nameInput().value).toBe("Mojca");
    expect(passwordInput().value).toBe(PASSWORD);
  });

  it.each([
    ["password_requirements_error", "Geslo ne izpolnjuje zahtev."],
    ["password_too_long", "Geslo je predolgo."],
  ])("a server %s is shown under the password", async (code, text) => {
    mocks.posts.push({ status: 400, body: { code } });
    await ready();
    await fill();
    await submit();

    expect((await screen.findByTestId("flowko-invite-password-error")).textContent).toBe(text);
  });

  it("Flowko U29e (E10.6): a 409 signed_in answer shows the already-signed-in view, no form, no password, no sign-in, no toast", async () => {
    mocks.posts.push({ status: 409, body: { code: "signed_in" } });
    await ready();
    await fill();
    await submit();

    const view = await screen.findByTestId("flowko-invite-signed-in");
    expect(screen.getByRole("heading", { name: "Ste že prijavljeni" })).toBeTruthy();
    expect(view.textContent).toContain(
      "Za sprejem povabila se najprej odjavite, nato povezavo odprite znova."
    );
    expect(screen.getByRole("link", { name: "Odjava" }).getAttribute("href")).toBe("/auth/logout");
    expect(screen.queryByTestId("flowko-invite-accept-form")).toBeNull();
    expect(screen.queryByLabelText("Geslo")).toBeNull();
    expect(screen.queryByLabelText("Potrdi geslo")).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByTestId("flowko-invite-accept-error")).toBeNull();
    expect(document.body.textContent).not.toContain("Nekaj je šlo narobe.");
    expect(document.body.textContent).not.toContain(PASSWORD);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(1);
  });

  it("member_conflict (409, shared status with signed_in) keeps the form and its own text", async () => {
    mocks.posts.push({ status: 409, body: { code: "member_conflict" } });
    await ready();
    await fill();
    await submit();

    await waitFor(() => expect(alertText()).toBe("Hkrati je shranjeval še nekdo. Poskusite znova."));
    expect(screen.queryByTestId("flowko-invite-signed-in")).toBeNull();
    expect(screen.getByTestId("flowko-invite-accept-form")).toBeTruthy();
    expect(passwordInput().value).toBe(PASSWORD);
  });

  it.each([
    [
      "429 from the limiter",
      { status: 429, body: { message: "Rate limit exceeded. Try again in 9 seconds." } },
      "Preveč zahtev. Poskusite znova čez trenutek.",
    ],
    [
      "member_conflict",
      { status: 409, body: { code: "member_conflict" } },
      "Hkrati je shranjeval še nekdo. Poskusite znova.",
    ],
    ["server_error", { status: 500, body: { code: "server_error" } }, "Nekaj je šlo narobe."],
    [
      "the CSRF refusal",
      { status: 403, body: { success: false, message: "Invalid CSRF token" } },
      "Nekaj je šlo narobe.",
    ],
    ["an unknown code", { status: 400, body: { code: "whatever" } }, "Nekaj je šlo narobe."],
    ["a body that is not JSON", { status: 502, body: null, badJson: true }, "Nekaj je šlo narobe."],
    ["a network failure", { status: 0, body: null, throws: true }, "Nekaj je šlo narobe."],
  ])("%s is shown in Slovene, never raw, never as a toast", async (_label, post, text) => {
    mocks.posts.push(post);
    await ready();
    await fill();
    await submit();

    await waitFor(() => expect(alertText()).toBe(text));
    expect(document.body.textContent).not.toContain("Rate limit exceeded");
    expect(document.body.textContent).not.toContain("Invalid CSRF");
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("fetches a fresh CSRF token after every failed POST and sends it with the next try", async () => {
    mocks.posts.push({ status: 500, body: { code: "server_error" } });
    mocks.posts.push({ status: 0, body: null, throws: true });
    await ready();
    await fill();

    await submit();
    await waitFor(() => expect(csrfCalls()).toBe(2));
    await submit();
    await waitFor(() => expect(csrfCalls()).toBe(3));
    await submit();

    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith(CALLBACK));
    expect(posts().map((p) => JSON.parse(String(p.init?.body)).csrfToken)).toEqual([
      "csrf-1",
      "csrf-2",
      "csrf-3",
    ]);
  });

  it("sends once on a double click", async () => {
    let release: (value: unknown) => void = () => undefined;
    mocks.signIn.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    await ready();
    await fill();
    await act(async () => {
      const button = screen.getByRole("button", { name: "Pridruži se" });
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
    expect(posts()).toHaveLength(1);
    await act(async () => release({ ok: true, error: null }));
  });
});
