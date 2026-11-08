// Flowko U28: the now-line follows the server's clock (R18): the server's grid-rounded `now` plus the time since
// the answer came, with the device clock trusted only inside the slot the server named.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NowLine, deskNowMs } from "./NowLine";
import { TZ, at } from "./desk.fixture";

const MIN = 60_000;

describe("deskNowMs (U28 R18)", () => {
  const server = at("08:00"); // the server's now (true time 08:07), rounded down to a 15-minute grid

  it("uses the device clock inside the server's slot", () => {
    expect(deskNowMs(server, at("08:07"), 15, at("08:07"))).toBe(at("08:07"));
  });

  it("never goes before the server's now plus the time since the answer (device clock an hour slow)", () => {
    expect(deskNowMs(server, at("07:07"), 15, at("07:12"))).toBe(at("08:05"));
  });

  it("never runs more than one slot ahead of the server (device clock 90 minutes fast)", () => {
    expect(deskNowMs(server, at("09:37"), 15, at("09:39"))).toBe(at("08:17"));
  });
});

describe("NowLine (U28)", () => {
  afterEach(() => vi.useRealTimers());

  it("sits at the current time and moves every minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at("08:07"));
    render(
      <NowLine
        serverNow={at("08:07")}
        receivedAt={at("08:07")}
        stepMinutes={15}
        range={{ from: at("08:00"), to: at("19:00") }}
        pxPerMinute={2}
        timeZone={TZ}
      />
    );
    const line = screen.getByTestId("desk-now-line");
    expect(line.style.top).toBe("14px");
    expect(line.textContent).toBe("08:07");
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(line.style.top).toBe("16px");
    expect(line.textContent).toBe("08:08");
  });

  it("is not drawn outside the visible hours", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("20:00"));
    render(
      <NowLine
        serverNow={at("20:00")}
        receivedAt={at("20:00")}
        stepMinutes={15}
        range={{ from: at("08:00"), to: at("19:00") }}
        pxPerMinute={2}
        timeZone={TZ}
      />
    );
    expect(screen.queryByTestId("desk-now-line")).toBeNull();
  });
});
