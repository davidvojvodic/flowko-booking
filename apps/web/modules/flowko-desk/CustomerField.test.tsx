// Flowko U28: customer lookup (R11): one search field, debounced 300 ms, results from bookings.customers; picking a
// result hands over name/phone/e-mail, „Nova stranka“ asks for a blank customer.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerField } from "./CustomerField";
import { localeT } from "./desk.fixture";
import { deskTrpc, resetDeskTrpc } from "./desk.testDoubles";

vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule);
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const marija = { name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" };
const lastQuery = () => deskTrpc.customersQuery.mock.calls[deskTrpc.customersQuery.mock.calls.length - 1];

describe("CustomerField (U28 R11)", () => {
  beforeEach(() => {
    resetDeskTrpc();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("asks the server only after 300 ms of quiet and only for 2+ characters", () => {
    render(<CustomerField onPick={vi.fn()} onNew={vi.fn()} />);
    const search = screen.getByLabelText("Ime ali telefon");
    fireEvent.change(search, { target: { value: "M" } });
    act(() => vi.advanceTimersByTime(400));
    expect(lastQuery()[1]).toMatchObject({ enabled: false });
    fireEvent.change(search, { target: { value: "Mar" } });
    act(() => vi.advanceTimersByTime(299));
    expect(lastQuery()[0]).toEqual({ query: "M" });
    act(() => vi.advanceTimersByTime(1));
    expect(lastQuery()).toEqual([{ query: "Mar" }, expect.objectContaining({ enabled: true })]);
  });

  it("picking a result hands over name, phone and e-mail", () => {
    deskTrpc.customersQuery.mockReturnValue({ data: [marija], isFetching: false });
    const onPick = vi.fn();
    render(<CustomerField onPick={onPick} onNew={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Ime ali telefon"), { target: { value: "041 123" } });
    act(() => vi.advanceTimersByTime(300));
    expect(lastQuery()[0]).toEqual({ query: "041 123" });
    fireEvent.click(screen.getByRole("button", { name: /Marija Novak/ }));
    expect(onPick).toHaveBeenCalledWith(marija);
  });

  it("says when nobody is found and offers „Nova stranka“", () => {
    deskTrpc.customersQuery.mockReturnValue({ data: [], isFetching: false });
    const onNew = vi.fn();
    render(<CustomerField onPick={vi.fn()} onNew={onNew} />);
    fireEvent.change(screen.getByLabelText("Ime ali telefon"), { target: { value: "u28" } });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText("Ni najdenih strank.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
    expect(onNew).toHaveBeenCalled();
  });
});
