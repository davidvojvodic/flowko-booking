import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tabs } from "@calcom/features/embed/lib/EmbedTabs";
import { useEmbedTypes } from "@calcom/features/embed/lib/hooks";
import { EMBED_LIB_URL, WEBAPP_URL } from "@calcom/lib/constants";

import { EmbedButton, EmbedDialog } from "./Embed";

// Flowko U13-02..06, U13-22: the Embed dialog in Slovenian (and English), with the code from buildFlowkoSnippet.

const mocks = vi.hoisted(() => ({
  lang: "sl" as "sl" | "en",
  query: "",
  push: vi.fn(),
}));

vi.mock("@calcom/lib/hooks/useLocale", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const load = (lang: string): Record<string, string> =>
    JSON.parse(
      readFileSync(
        path.resolve(__dirname, `../../../../../packages/i18n/locales/${lang}/common.json`),
        "utf8"
      )
    );
  const dictionaries: Record<string, Record<string, string>> = { sl: load("sl"), en: load("en") };
  const t = (key: string, options?: Record<string, unknown>) =>
    (dictionaries[mocks.lang][key] ?? key).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
      options && name in options ? String(options[name]) : match
    );
  const i18n = {
    get language() {
      return mocks.lang;
    },
    exists: (key: string) => key in dictionaries[mocks.lang],
  };
  return {
    useLocale: () => ({ t, i18n, isLocaleReady: true }),
  };
});

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/event-types",
  useSearchParams: () => new URLSearchParams(mocks.query),
  useParams: () => ({}),
}));

vi.mock("@calcom/lib/hooks/useCompatSearchParams", () => ({
  useCompatSearchParams: () => new URLSearchParams(mocks.query),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { username: "flowko-test" } }, status: "authenticated" }),
}));

vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      eventTypes: { get: { useQuery: () => ({ data: undefined }) } },
      me: { get: { useQuery: () => ({ data: { timeZone: "Europe/Ljubljana" } }) } },
    },
  },
}));

// The email embed's booker widgets are not offered (Q10) and never render here.
vi.mock("@calcom/web/modules/bookings/components/AvailableTimes", () => ({ AvailableTimes: () => null }));
vi.mock("@calcom/web/modules/bookings/components/AvailableTimesHeader", () => ({
  AvailableTimesHeader: () => null,
}));
vi.mock("@calcom/features/calendars/components/DatePicker", () => ({ default: () => null }));
vi.mock("@calcom/web/modules/timezone/components/TimezoneSelect", () => ({ TimezoneSelect: () => null }));
vi.mock("@calcom/web/modules/schedules/hooks/useEvent", () => ({
  useEvent: () => ({}),
  useScheduleForEvent: () => ({}),
}));
vi.mock("@calcom/web/modules/schedules/hooks/useNonEmptyScheduleDays", () => ({
  useNonEmptyScheduleDays: () => [],
}));
vi.mock("@calcom/web/modules/schedules/hooks/useSlotsForDate", () => ({ useSlotsForDate: () => [] }));

const PROFILE = { brandColor: "#0F766E", darkBrandColor: "#fafafa" };

function Harness({ defaultBrandColor = PROFILE }: { defaultBrandColor?: typeof PROFILE | null }) {
  const types = useEmbedTypes();
  return (
    <EmbedDialog
      types={types}
      tabs={tabs}
      eventTypeHideOptionDisabled={false}
      defaultBrandColor={defaultBrandColor}
    />
  );
}

function openDialog(
  embedType: string | null,
  {
    embedTabName = "embed-code",
    defaultBrandColor,
  }: { embedTabName?: string; defaultBrandColor?: typeof PROFILE | null } = {}
) {
  const params = new URLSearchParams({
    dialog: "embed",
    embedUrl: "flowko-test/ogled",
    namespace: "ogled",
    eventId: "1",
  });
  if (embedType) {
    params.set("embedType", embedType);
    params.set("embedTabName", embedTabName);
  }
  mocks.query = params.toString();
  return render(<Harness defaultBrandColor={defaultBrandColor} />);
}

const code = () => (screen.getByTestId("embed-code") as HTMLTextAreaElement).value;

/** The hex input of the colour picker under a label. */
function colorInput(label: string) {
  const labelEl = screen.getByText(label);
  return within(labelEl.parentElement as HTMLElement).getByRole("textbox");
}

/** The page's text with each select's menu open in turn, so the option labels are included. */
function textWithEverySelectOpen() {
  const texts = [document.body.textContent ?? ""];
  for (const combobox of screen.queryAllByRole("combobox")) {
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
    texts.push(document.body.textContent ?? "");
    fireEvent.keyDown(combobox, { key: "Escape", code: "Escape" });
  }
  return texts.join("\n");
}

// What the dialog showed in English before U13-04.
const ENGLISH_LITERALS = [
  "Auto",
  "Dark Theme",
  "Light Theme",
  "Bottom right",
  "Bottom left",
  "Window sizing",
  "Button text",
  "Display calendar icon",
  "Position of button",
  "Button color",
  "Text color",
  "Embed theme",
  "HTML (iframe)",
  "React (iframe)",
  "React (Atom)",
  "Preview",
  "Book my Cal",
  "Rezerviraj moj Cal",
  "mins",
];

beforeEach(() => {
  mocks.lang = "sl";
  mocks.push.mockClear();
});

afterEach(() => {
  mocks.query = "";
});

describe("Embed dialog (Flowko U13)", () => {
  it("offers three embed types, in Slovenian (no email or headless type)", () => {
    openDialog(null);
    const cards = ["inline", "floating-popup", "element-click"].map((type) => screen.getByTestId(type));
    expect(cards).toHaveLength(3);
    expect(screen.queryByTestId("email")).toBeNull();
    expect(screen.queryByTestId("headless")).toBeNull();
    expect(screen.getByText("Pojavno okno ob kliku na vaš gumb")).toBeTruthy();
    expect(screen.getByText("Lebdeči gumb")).toBeTruthy();
  });

  it("closes for a type it no longer offers", () => {
    openDialog("email");
    expect(screen.queryByTestId("embed-code")).toBeNull();
    expect(mocks.push).toHaveBeenCalled();
    expect(mocks.push.mock.calls.at(-1)?.[0]).not.toContain("embedType=email");
  });

  describe("floating button", () => {
    it("shows only the HTML code tab, labelled in Slovenian", () => {
      openDialog("floating-popup");
      const tabLinks = within(screen.getByTestId("embed-tabs")).getAllByRole("link");
      expect(tabLinks.map((link) => link.textContent?.trim())).toEqual(["Koda HTML"]);
    });

    it("the code has the default text, the profile brand colour and a contrasting text colour", () => {
      openDialog("floating-popup");
      const snippet = code();
      expect(snippet.startsWith("<!-- Flowko Rezervacije: lebdeči gumb (začetek) -->")).toBe(true);
      expect(snippet).toContain('"buttonText": "Rezervirajte termin"');
      expect(snippet).toContain('"buttonColor": "#0F766E"');
      expect(snippet).toContain('"buttonTextColor": "#FFFFFF"');
      expect(snippet).toContain('"buttonPosition": "bottom-right"');
      expect(snippet).toContain('"theme": "light"');
      expect(snippet).toContain(`})(window, "${EMBED_LIB_URL}", "init");`);
      // Flowko P0: the floating button has its own namespace, so it can share a page with the calendar
      expect(snippet).toContain(`Cal("init", "ogled_lebdeci", { origin: "${new URL(WEBAPP_URL).origin}" });`);
      expect(snippet).toContain('  Cal.ns.ogled_lebdeci("floatingButton", {');
      expect(snippet).toContain('data-cfasync="false" nowprocket');
      expect(snippet).not.toContain("cssVarsPerTheme");
      expect(snippet.match(/cal\.com/gi)).toBeNull();
      expect(screen.getByTestId("embed-code-hint").textContent).toBe(
        "Kodo dodajte enkrat za celo spletno stran, v nogo ali tik pred </body>."
      );
      expect((screen.getByTestId("embed-button-text") as HTMLInputElement).value).toBe("Rezervirajte termin");
      expect((colorInput("Barva gumba") as HTMLInputElement).value.toUpperCase()).toBe("0F766E");
      expect((colorInput("Barva besedila") as HTMLInputElement).value.toUpperCase()).toBe("FFFFFF");
    });

    it("a light brand colour gets black text", () => {
      openDialog("floating-popup", {
        defaultBrandColor: { brandColor: "#FFD700", darkBrandColor: "#fafafa" },
      });
      expect(code()).toContain('"buttonColor": "#FFD700"');
      expect(code()).toContain('"buttonTextColor": "#000000"');
    });

    it("without a profile colour: the booker's default colour", () => {
      openDialog("floating-popup", { defaultBrandColor: null });
      expect(code()).toContain('"buttonColor": "#292929"');
      expect(code()).toContain('"buttonTextColor": "#FFFFFF"');
    });

    it("the text colour follows a new button colour until the host picks one", () => {
      openDialog("floating-popup");
      fireEvent.change(colorInput("Barva gumba"), { target: { value: "FFD700" } });
      expect(code()).toContain('"buttonColor": "#FFD700"');
      expect(code()).toContain('"buttonTextColor": "#000000"');
      expect((colorInput("Barva besedila") as HTMLInputElement).value.toUpperCase()).toBe("000000");
      fireEvent.change(colorInput("Barva besedila"), { target: { value: "123456" } });
      fireEvent.change(colorInput("Barva gumba"), { target: { value: "000000" } });
      expect(code()).toContain('"buttonTextColor": "#123456"');
    });

    it("the button text field changes the code; a blank field falls back to the default", () => {
      openDialog("floating-popup");
      fireEvent.change(screen.getByTestId("embed-button-text"), { target: { value: "Naročite se" } });
      expect(code()).toContain('"buttonText": "Naročite se"');
      fireEvent.change(screen.getByTestId("embed-button-text"), { target: { value: " " } });
      expect(code()).toContain('"buttonText": "Rezervirajte termin"');
    });

    it("no English label is left, in any select either", () => {
      openDialog("floating-popup");
      const text = textWithEverySelectOpen();
      for (const literal of ENGLISH_LITERALS) {
        expect(text, literal).not.toContain(literal);
      }
      for (const label of [
        "Besedilo gumba",
        "Prikaži ikono koledarja",
        "Položaj gumba",
        "Spodaj desno",
        "Spodaj levo",
        "Barva gumba",
        "Barva besedila",
        "Tema vgradnje",
        "Svetla tema",
        "Temna tema",
        "Samodejno",
      ]) {
        expect(text, label).toContain(label);
      }
    });
  });

  describe("brand colour (Q7)", () => {
    it("no palette while the host keeps the profile colour; the full palette for another colour", () => {
      openDialog("inline");
      expect(code()).not.toContain("cssVarsPerTheme");
      fireEvent.change(colorInput("Barva znamke (svetla tema)"), { target: { value: "FFD700" } });
      const snippet = code();
      expect(snippet).toContain('"cssVarsPerTheme": {');
      for (const cssVar of [
        "cal-brand",
        "cal-brand-emphasis",
        "cal-brand-subtle",
        "cal-brand-text",
        "cal-brand-accent",
      ]) {
        expect(snippet).toContain(`"${cssVar}": `);
      }
      expect(snippet).toContain('"cal-brand": "#FFD700"');
      expect(snippet).not.toContain('"dark": {');
      // Back to the profile colour: nothing pinned again.
      fireEvent.change(colorInput("Barva znamke (svetla tema)"), { target: { value: "0f766e" } });
      expect(code()).not.toContain("cssVarsPerTheme");
    });
  });

  describe("inline", () => {
    it("Slovenian window-size labels and the inline code", () => {
      openDialog("inline");
      expect(screen.getByText("Velikost okna")).toBeTruthy();
      expect(screen.getByText("Š")).toBeTruthy();
      expect(screen.getByText("V")).toBeTruthy();
      expect(code()).toContain(
        '<div id="flowko-rezervacije-ogled" style="width:100%;height:100%;overflow:scroll"></div>'
      );
      // Flowko P0: the calendar keeps the event type's slug as its namespace
      expect(code()).toContain('  Cal.ns.ogled("inline", {');
      expect(screen.getByTestId("embed-code-hint").textContent).toBe(
        "Kodo prilepite na mesto na strani, kjer naj se prikaže koledar."
      );
    });
  });

  describe("element-click (Q1)", () => {
    it("our button by default, the client's own button as the other choice", () => {
      openDialog("element-click");
      expect(code()).toContain(
        `<button type="button" data-cal-link="flowko-test/ogled" data-cal-namespace="ogled_gumb"\n  data-cal-config='{"layout":"month_view","theme":"light"}'>Rezervirajte termin</button>`
      );
      expect(code()).not.toContain("Click me");
      expect(screen.getByTestId("embed-code-hint").textContent).toBe("Kodo prilepite tja, kjer naj bo gumb.");

      const variant = screen.getAllByRole("combobox")[0];
      fireEvent.focus(variant);
      fireEvent.keyDown(variant, { key: "ArrowDown", code: "ArrowDown" });
      fireEvent.click(screen.getByText("Vaš gumb (vodi na vašo stran za rezervacijo)"));

      const snippet = code();
      expect(
        snippet.startsWith("<!-- Flowko Rezervacije: vaši gumbi odprejo okno za rezervacijo (začetek) -->")
      ).toBe(true);
      expect(snippet).toContain('document.addEventListener("click", function (e) {');
      expect(snippet).toContain('    Cal.ns.ogled_povezava("modal", { calLink: "flowko-test/ogled",');
      expect(snippet).not.toContain("<button");
      expect(screen.getByTestId("embed-code-hint").textContent).toContain(
        `Vaš gumb naj vodi na ${WEBAPP_URL}/flowko-test/ogled.`
      );
      // No button text for the client's own button.
      expect(screen.getByTestId("embed-button-text").closest(".hidden")).not.toBeNull();
    });
  });

  it("English UI: English comments and button text", () => {
    mocks.lang = "en";
    openDialog("floating-popup");
    expect(code().startsWith("<!-- Flowko Rezervacije: floating button (start) -->")).toBe(true);
    expect(code()).toContain('"buttonText": "Book an appointment"');
    expect(screen.getByText("Button text")).toBeTruthy();
  });

  it("a link to a removed tab (React) goes to the HTML code tab", () => {
    openDialog("inline", { embedTabName: "embed-react" });
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining("embedTabName=embed-code"));
  });

  it("copy puts the shown code on the clipboard", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    openDialog("floating-popup");
    fireEvent.click(screen.getByText("Kopiraj kodo"));
    expect(writeText).toHaveBeenCalledWith(code());
  });
});

// U13-22: only the button's own class. Whether a page shows it at a width depends on the page's wrappers
// (event-types-listing-view.tsx, EventTypeLayout.tsx), which this test does not render.
describe("EmbedButton (U13-22)", () => {
  it("its own class no longer hides it below 1024 px", () => {
    mocks.query = "";
    render(
      <EmbedButton embedUrl="flowko-test%2Fogled" namespace="ogled" className="w-full">
        Vgradnja
      </EmbedButton>
    );
    const button = screen.getByTestId("embed");
    expect(button.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(button.className).toContain("w-full");
  });
});
