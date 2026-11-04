import { TooltipProvider } from "@radix-ui/react-tooltip";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Event } from "./Event";

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (k: string) => k, i18n: { language: "sl" } }),
}));

const TITLE = "Ogled (s potrditvijo) med Flowko Test in Testna stranka";

const renderEvent = (eventDuration: number) =>
  render(
    <TooltipProvider>
      <Event
        event={{
          id: 1,
          title: TITLE,
          start: new Date("2026-11-04T08:00:00Z"),
          end: new Date(new Date("2026-11-04T08:00:00Z").getTime() + eventDuration * 60000),
          options: { status: "ACCEPTED", bookingUid: "u1" },
        }}
        eventDuration={eventDuration}
        onEventClick={() => undefined}
      />
    </TooltipProvider>
  );

// Flowko U19: a long title ends in „…" and never pushes the time out of the block
// (3 Nov walk: a 30-minute booking showed „itvijo) med Flowko Test in").
describe("Event title in a short block", () => {
  it.each([30, 42, 60])("%i minutes: the title truncates and the time keeps its width", (duration) => {
    renderEvent(duration);
    const title = screen.getAllByText(TITLE).find((el) => el.closest("button"));
    expect(title).toBeDefined();
    expect(title).toHaveClass("truncate", "min-w-0");
    const time = title?.closest("button")?.querySelector("p.text-subtle");
    expect(time).toHaveClass("shrink-0");
    // every flex box between the title and the button may shrink below its content
    let node = title?.parentElement;
    while (node && node.tagName !== "BUTTON") {
      expect(node).toHaveClass("min-w-0");
      node = node.parentElement;
    }
  });
});
