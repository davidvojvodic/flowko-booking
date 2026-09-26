/* eslint-disable playwright/missing-playwright-await */
import { render, screen } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import Credits from "./Credits";

vi.mock("@calcom/lib/constants", async () => {
  const actual = (await vi.importActual("@calcom/lib/constants")) as typeof import("@calcom/lib/constants");
  return {
    ...actual,
    CALCOM_VERSION: "mockedVersion",
    COMPANY_NAME: "Example Company s.p.",
    // Flowko: even with cal.com's own settings the footer must not link to cal.com or calcom's GitHub
    IS_CALCOM: true,
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Tests for Credits component", () => {
  test("Should render credits section with links", () => {
    render(<Credits />);

    const creditsLinkElement = screen.getByRole("link", { name: "Example Company s.p." });
    expect(creditsLinkElement).toBeInTheDocument();
    expect(creditsLinkElement).toHaveAttribute("href", "https://flowko.si");
    expect(creditsLinkElement).toHaveAttribute("target", "_blank");
  });

  test("Should render credits section with correct text", () => {
    render(<Credits />);

    const currentYear = new Date().getFullYear();
    const copyrightElement = screen.getByText(`© ${currentYear}`);
    expect(copyrightElement).toHaveTextContent(`${currentYear}`);
  });

  // Flowko: upstream linked the version to https://go.cal.com/releases
  test("Flowko: shows the version as plain text, not as a link", () => {
    const { container } = render(<Credits />);

    expect(container).toHaveTextContent("v.mockedVersion-");
    expect(screen.queryByRole("link", { name: /mockedVersion/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  test("Flowko: links nowhere on cal.com or calcom's GitHub", () => {
    const { container } = render(<Credits />);

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://flowko.si"]);
    expect(container.innerHTML).not.toMatch(/cal\.com|calcom/i);
  });

  // Upstream linked the commit to https://github.com/calcom/cal.diy/commit/<sha> on cal.com
  test("Flowko: shows a build's commit as plain text", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "abc1234def5678");
    vi.resetModules();
    const { default: CreditsWithCommit } = await import("./Credits");

    const { container } = render(<CreditsWithCommit />);

    expect(container).toHaveTextContent("v.mockedVersion-sh-abc1234");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(container.innerHTML).not.toMatch(/github\.com|calcom/i);
  });
});
