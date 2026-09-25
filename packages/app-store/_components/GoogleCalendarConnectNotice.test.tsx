import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import { WEBSITE_PRIVACY_POLICY_URL } from "@calcom/lib/constants";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleCalendarConnectGate,
  GoogleCalendarConnectNoticeProvider,
} from "./GoogleCalendarConnectNotice";

const locale = vi.hoisted(() => ({ strings: {} as Record<string, string> }));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({
    t: (key: string, options: Record<string, unknown> = {}) =>
      (locale.strings[key] ?? key).replace(/{{\s*(\w+)\s*}}/g, (_match: string, name: string) =>
        String(options[name])
      ),
  }),
}));

const clickConnect = () => fireEvent.click(screen.getByRole("button", { name: "Connect" }));
const notice = () => screen.queryByTestId("google-calendar-connect-notice");

describe("GoogleCalendarConnectGate", () => {
  beforeEach(() => {
    locale.strings = en as unknown as Record<string, string>;
  });

  it("shows the data-use notice instead of running the button's click handler", () => {
    const onClick = vi.fn();
    render(
      <GoogleCalendarConnectGate>
        <button type="button" onClick={onClick}>
          Connect
        </button>
      </GoogleCalendarConnectGate>
    );

    expect(notice()).toBeNull();
    clickConnect();

    expect(onClick).not.toHaveBeenCalled();
    expect(notice()?.textContent).toBe(
      "Flowko Rezervacije will read the list of your calendars and the times you are busy in the calendars you choose, and will create, update and delete the events for bookings made through it. It does not read the contents of your other events. See section 3.3 of the privacy policy."
    );
    expect(screen.getByRole("link", { name: "privacy policy" })).toHaveAttribute(
      "href",
      WEBSITE_PRIVACY_POLICY_URL
    );
  });

  it("runs the button's click handler once the user continues", () => {
    const onClick = vi.fn();
    render(
      <GoogleCalendarConnectGate>
        <button type="button" onClick={onClick}>
          Connect
        </button>
      </GoogleCalendarConnectGate>
    );

    clickConnect();
    fireEvent.click(screen.getByTestId("dialog-confirmation"));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
  });

  it("does not run the button's click handler when the user cancels", () => {
    const onClick = vi.fn();
    render(
      <GoogleCalendarConnectGate>
        <button type="button" onClick={onClick}>
          Connect
        </button>
      </GoogleCalendarConnectGate>
    );

    clickConnect();
    fireEvent.click(screen.getByTestId("dialog-rejection"));

    expect(onClick).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });

  it("keeps the notice open after the button unmounts when a provider hosts it", () => {
    const onClick = vi.fn();
    // Like a dropdown menu, which closes and unmounts its items when one is clicked.
    const Menu = () => {
      const [open, setOpen] = useState(true);
      return open ? (
        <div onClick={() => setOpen(false)}>
          <GoogleCalendarConnectGate>
            <button type="button" onClick={onClick}>
              Connect
            </button>
          </GoogleCalendarConnectGate>
        </div>
      ) : null;
    };
    render(
      <GoogleCalendarConnectNoticeProvider>
        <Menu />
      </GoogleCalendarConnectNoticeProvider>
    );

    clickConnect();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(notice()).not.toBeNull();

    fireEvent.click(screen.getByTestId("dialog-confirmation"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows the notice in Slovenian", () => {
    locale.strings = sl as unknown as Record<string, string>;
    render(
      <GoogleCalendarConnectGate>
        <button type="button">Connect</button>
      </GoogleCalendarConnectGate>
    );

    clickConnect();

    expect(notice()?.textContent).toBe(
      "Aplikacija Flowko Rezervacije bo brala seznam vaših koledarjev in čase, ko ste zasedeni v koledarjih, ki jih izberete, ter ustvarjala, spreminjala in brisala dogodke za rezervacije, opravljene prek nje. Vsebine drugih dogodkov ne bere. Več v razdelku 3.3 pravilnika o zasebnosti."
    );
    expect(screen.getByRole("link", { name: "pravilnika o zasebnosti" })).toHaveAttribute(
      "href",
      WEBSITE_PRIVACY_POLICY_URL
    );
  });
});
