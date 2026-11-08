// Flowko U28: customer lookup (R11): one search field, debounced 300 ms, results from bookings.customers; picking a
// result hands over name/phone/e-mail, „Nova stranka“ asks for a new customer pre-filled from the typed text (U28b
// B2); the picked customer shows as a card with „Zamenjaj“.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerCard, CustomerField, prefillFromSearch } from "./CustomerField";
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
    expect(onNew).toHaveBeenCalledWith({ name: "u28", phone: "" });
  });

  // Flowko U28b (B2): „Nova stranka“ hands over what was typed (letters → name, phone characters → phone) and
  // empties the search.
  it("„Nova stranka“ hands over the typed text as a name or a phone and empties the search", () => {
    const onNew = vi.fn();
    render(<CustomerField onPick={vi.fn()} onNew={onNew} />);
    const search = screen.getByLabelText("Ime ali telefon") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "  Marija Novak " } });
    fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
    expect(onNew).toHaveBeenLastCalledWith({ name: "Marija Novak", phone: "" });
    expect(search.value).toBe("");
    fireEvent.change(search, { target: { value: "041 123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
    expect(onNew).toHaveBeenLastCalledWith({ name: "", phone: "041 123 456" });
  });
});

describe("prefillFromSearch (U28b B2)", () => {
  it.each([
    ["Marija Novak", { name: "Marija Novak", phone: "" }],
    ["  Špela ", { name: "Špela", phone: "" }],
    ["Ana 2", { name: "Ana 2", phone: "" }],
    ["041 123 456", { name: "", phone: "041 123 456" }],
    ["+386 (41) 123-456", { name: "", phone: "+386 (41) 123-456" }],
    ["041/123.456", { name: "", phone: "041/123.456" }],
    ["", { name: "", phone: "" }],
    ["   ", { name: "", phone: "" }],
    ["+-()", { name: "", phone: "" }],
  ])("%j → %j", (text, expected) => {
    expect(prefillFromSearch(text)).toEqual(expected);
  });
});

describe("CustomerCard (U28b B2)", () => {
  it("shows name, phone and e-mail; „Zamenjaj“ goes back to the search", () => {
    const onChange = vi.fn();
    render(<CustomerCard customer={marija} onChange={onChange} />);
    const card = screen.getByTestId("desk-customer-card");
    expect(card.textContent).toContain("Marija Novak");
    expect(card.textContent).toContain("+38641123456");
    expect(card.textContent).toContain("marija@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Zamenjaj" }));
    expect(onChange).toHaveBeenCalled();
  });

  it("leaves out what the customer does not have", () => {
    render(
      <CustomerCard customer={{ name: "Bojan", phone: null, email: "b@example.com" }} onChange={vi.fn()} />
    );
    const card = screen.getByTestId("desk-customer-card");
    expect(card.textContent).toContain("Bojan");
    expect(card.textContent).toContain("b@example.com");
    expect(card.textContent).not.toContain("null");
    expect(screen.queryByTestId("desk-customer-card-phone")).toBeNull();
  });
});
