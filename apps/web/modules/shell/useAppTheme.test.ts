import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useMeQuery: vi.fn(),
  useTheme: vi.fn(),
  useCalcomTheme: vi.fn(),
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({ useBrandColors: () => ({}) }));
vi.mock("@calcom/lib/hooks/useTheme", () => ({ default: mocks.useTheme }));
vi.mock("@calcom/trpc/react/hooks/useMeQuery", () => ({ default: mocks.useMeQuery }));
vi.mock("@calcom/ui/styles", () => ({ useCalcomTheme: mocks.useCalcomTheme }));

import { useAppTheme } from "./useAppTheme";

describe("useAppTheme (Flowko U14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gives the app Flowko's colours, whatever colour the host chose in Videz", () => {
    mocks.useMeQuery.mockReturnValue({
      data: { brandColor: "#0F766E", darkBrandColor: "#123456", appTheme: "light" },
    });

    useAppTheme();

    const theme = mocks.useCalcomTheme.mock.calls[0][0];
    expect(theme.light["cal-brand"]).toBe("#7A3FD1");
    expect(theme.dark["cal-brand"]).toBe("#AC6AFF");
  });

  it("gives the same colours before the user has loaded", () => {
    mocks.useMeQuery.mockReturnValue({ data: undefined });

    useAppTheme();

    const theme = mocks.useCalcomTheme.mock.calls[0][0];
    expect(theme.light["cal-brand"]).toBe("#7A3FD1");
    expect(theme.dark["cal-brand"]).toBe("#AC6AFF");
  });

  it("still follows the host's own app theme", () => {
    mocks.useMeQuery.mockReturnValue({ data: { appTheme: "dark" } });

    useAppTheme();

    expect(mocks.useTheme).toHaveBeenCalledWith("dark");
  });
});
