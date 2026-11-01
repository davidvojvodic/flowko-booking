import { TooltipProvider } from "@radix-ui/react-tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AppearanceView from "./appearance-view";

// Flowko U14: Videz treats a stored upstream default as "no colour chosen", Reset stores the new defaults, and the
// host's own colour no longer tints their own app.

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("app/(use-page-wrapper)/settings/(settings-layout)/my-account/appearance/actions", () => ({
  revalidateSettingsAppearance: vi.fn(),
}));
vi.mock("app/cache/membership", () => ({ revalidateHasTeamPlan: vi.fn() }));
vi.mock("@formkit/auto-animate/react", () => ({ useAutoAnimate: () => [null] }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: {} } }) }));
vi.mock("@calcom/web/modules/settings/components/BookerLayoutSelector", () => ({
  BookerLayoutSelector: () => null,
}));
vi.mock("@calcom/features/settings/ThemeLabel", () => ({ default: () => null }));
vi.mock("@calcom/features/settings/appDir/SettingsHeader", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@calcom/lib/hooks/useTheme", () => ({ default: vi.fn() }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ viewer: { me: { invalidate: vi.fn() } } }),
    viewer: {
      me: { updateProfile: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) } },
    },
  },
}));

type Props = React.ComponentProps<typeof AppearanceView>;

const renderView = (colors: { brandColor: string | null; darkBrandColor: string | null }) =>
  render(
    <TooltipProvider>
      <AppearanceView
        user={{ ...colors, theme: null, appTheme: "light", metadata: {}, hideBranding: false } as Props["user"]}
        hasPaidPlan={false}
      />
    </TooltipProvider>
  );

const brandSwitch = () => screen.getAllByRole("switch")[0];
const inputValues = () => screen.getAllByRole("textbox").map((input) => (input as HTMLInputElement).value);

describe("Videz: brand colours (Flowko U14)", () => {
  beforeEach(() => {
    mocks.mutate.mockClear();
    document.documentElement.removeAttribute("style");
  });

  it.each([
    ["the stored upstream defaults", { brandColor: "#292929", darkBrandColor: "#fafafa" }],
    ["the new defaults", { brandColor: "#7A3FD1", darkBrandColor: "#AC6AFF" }],
    ["nothing stored", { brandColor: null, darkBrandColor: null }],
  ])("%s: the custom colours switch is off", (_label, colors) => {
    renderView(colors);

    expect(brandSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("the host's own colour: the switch is on and shows their colour", () => {
    renderView({ brandColor: "#0F766E", darkBrandColor: "#fafafa" });

    expect(brandSwitch().getAttribute("aria-checked")).toBe("true");
    expect(inputValues().map((value) => value.toUpperCase())).toEqual(["0F766E", "FAFAFA"]);
  });

  it("the host's own dark colour alone also turns the switch on", () => {
    renderView({ brandColor: "#292929", darkBrandColor: "#123456" });

    expect(brandSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("the pickers show the new defaults for a stored upstream default", () => {
    renderView({ brandColor: "#292929", darkBrandColor: "#fafafa" });

    fireEvent.click(brandSwitch());

    expect(inputValues().map((value) => value.toUpperCase())).toEqual(["7A3FD1", "AC6AFF"]);
  });

  it("turning the switch off stores the new defaults", () => {
    renderView({ brandColor: "#0F766E", darkBrandColor: "#fafafa" });

    fireEvent.click(brandSwitch());

    expect(mocks.mutate).toHaveBeenCalledWith({ brandColor: "#7A3FD1", darkBrandColor: "#AC6AFF" });
  });

  it("the host's own colour does not tint the page they are on", () => {
    renderView({ brandColor: "#0F766E", darkBrandColor: "#fafafa" });

    expect(document.documentElement.style.getPropertyValue("--cal-brand")).toBe("");
  });
});
