import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useHasMounted } from "./useHasMounted";

// Flowko U20: lets a component render browser-only values (local time zone, current time) after
// hydration, so the server HTML and the first browser render match.
const Probe = () => <span data-testid="mounted">{String(useHasMounted())}</span>;

describe("useHasMounted", () => {
  it("is false during the server render", () => {
    expect(renderToString(<Probe />)).toContain(">false<");
  });

  it("is true after the first browser effect", () => {
    render(<Probe />);
    expect(screen.getByTestId("mounted")).toHaveTextContent("true");
  });
});
