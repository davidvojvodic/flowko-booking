// Flowko U29a: the services page (S8–S13, S17). Reads services.list (no suspense, no server initial data); lists
// the services in position order with the total, the steps bar, who does each („Nihče“ when nobody) and up/down
// buttons that send the whole new order (a stale list answers bad_service → refetch + its text); „Uredi“ and
// „Nova storitev“ open the sheet; an empty catalogue shows the empty state. Every service write invalidates
// services.list, business.services and bookings.freeStarts.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServicesView from "./services-view";
import { BARVANJE, FEN, localeT, SERVICES_VIEW, STRIZENJE } from "./settings.fixture";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  reorder: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
  invalidateList: vi.fn(),
  invalidateDeskServices: vi.fn(),
  invalidateFreeStarts: vi.fn(),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => mocks.toast(...args) }));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      viewer: {
        flowko: {
          services: { list: { invalidate: mocks.invalidateList } },
          business: { services: { invalidate: mocks.invalidateDeskServices } },
          bookings: { freeStarts: { invalidate: mocks.invalidateFreeStarts } },
        },
      },
    }),
    viewer: {
      flowko: {
        services: {
          list: { useQuery: (...args: unknown[]) => mocks.query(...args) },
          reorder: {
            useMutation: () => ({ mutateAsync: (input: unknown) => mocks.reorder(input), isPending: false }),
          },
          save: {
            useMutation: () => ({ mutateAsync: (input: unknown) => mocks.save(input), isPending: false }),
          },
          remove: {
            useMutation: () => ({ mutateAsync: (input: unknown) => mocks.remove(input), isPending: false }),
          },
        },
      },
    },
  },
}));

function trpcError(message: string, code = "BAD_REQUEST") {
  return Object.assign(new Error(message), { data: { code } });
}

let data: typeof SERVICES_VIEW | undefined;
const queryResult = (over: Record<string, unknown> = {}) => ({
  data,
  isPending: data === undefined,
  isFetching: false,
  error: null,
  refetch: mocks.refetch,
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  data = SERVICES_VIEW;
  mocks.query.mockImplementation(() => queryResult());
  mocks.refetch.mockResolvedValue(undefined);
  mocks.reorder.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue({ serviceId: 99 });
  mocks.remove.mockResolvedValue(undefined);
  for (const fn of [mocks.invalidateList, mocks.invalidateDeskServices, mocks.invalidateFreeStarts]) {
    fn.mockResolvedValue(undefined);
  }
});

const rows = () => screen.getAllByTestId(/^flowko-service-row-\d+$/);
const row = (id: number) => screen.getByTestId(`flowko-service-row-${id}`);
const button = (name: string) => screen.getByRole("button", { name });

function expectS17Invalidated() {
  expect(mocks.invalidateList).toHaveBeenCalled();
  expect(mocks.invalidateDeskServices).toHaveBeenCalled();
  expect(mocks.invalidateFreeStarts).toHaveBeenCalled();
}

describe("ServicesView: loading", () => {
  it("reads services.list without suspense or server initial data", () => {
    render(<ServicesView />);
    const [queryInput, options] = mocks.query.mock.calls[0];
    expect(queryInput).toBeUndefined();
    expect(options).toEqual({ refetchOnWindowFocus: false });
  });

  it("shows a skeleton while loading", () => {
    data = undefined;
    render(<ServicesView />);
    expect(screen.getByTestId("flowko-settings-services-loading")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nova storitev" })).toBeNull();
  });

  it("a failed load says so and retries on request", () => {
    data = undefined;
    mocks.query.mockImplementation(() => queryResult({ isPending: false, error: trpcError("forbidden") }));
    render(<ServicesView />);
    expect(screen.getByText("Storitev ni bilo mogoče naložiti.")).toBeInTheDocument();
    fireEvent.click(button("Poskusi znova"));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});

describe("ServicesView: the list", () => {
  it("lists the services in position order", () => {
    render(<ServicesView />);
    expect(rows().map((r) => r.dataset.testid)).toEqual([
      `flowko-service-row-${STRIZENJE.id}`,
      `flowko-service-row-${BARVANJE.id}`,
      `flowko-service-row-${FEN.id}`,
    ]);
  });

  it("each row shows the name, category, total minutes and the steps bar", () => {
    render(<ServicesView />);
    const r = within(row(BARVANJE.id));
    expect(r.getByText("Barvanje")).toBeInTheDocument();
    expect(r.getByText("Barve")).toBeInTheDocument();
    expect(r.getByTestId("flowko-service-total")).toHaveTextContent("75 min");
    const segments = Array.from(r.getByTestId("flowko-steps-bar").children) as HTMLElement[];
    expect(segments.map((s) => s.dataset.kind)).toEqual(["busy", "processing", "busy"]);
    expect(segments[1].dataset.pattern).toBe("hatched");
  });

  it("who does it: the assigned names in roster order, a LOCKED one marked, „Nihče“ when nobody", () => {
    render(<ServicesView />);
    expect(within(row(STRIZENJE.id)).getByTestId("flowko-service-workers")).toHaveTextContent("Ana, Bor");
    expect(within(row(BARVANJE.id)).getByTestId("flowko-service-workers")).toHaveTextContent(
      "Ana, Dan (zaklenjeno)"
    );
    expect(within(row(FEN.id)).getByTestId("flowko-service-workers")).toHaveTextContent("Nihče");
  });

  it("an empty catalogue shows the empty state with „Nova storitev“", () => {
    data = { ...SERVICES_VIEW, services: [] };
    render(<ServicesView />);
    expect(screen.getByText("Še nimate storitev")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^flowko-service-row-\d+$/)).toHaveLength(0);
    fireEvent.click(button("Nova storitev"));
    expect(screen.getByRole("heading", { name: "Nova storitev" })).toBeInTheDocument();
  });
});

describe("ServicesView: order (S13)", () => {
  it("the first row cannot go up, the last cannot go down", () => {
    render(<ServicesView />);
    expect(button("Premakni gor: Striženje")).toBeDisabled();
    expect(button("Premakni dol: Fen")).toBeDisabled();
    expect(button("Premakni dol: Striženje")).not.toBeDisabled();
  });

  it("down sends the whole new order and invalidates the S17 queries", async () => {
    render(<ServicesView />);
    await act(async () => {
      fireEvent.click(button("Premakni dol: Striženje"));
    });
    expect(mocks.reorder).toHaveBeenCalledWith({ serviceIds: [BARVANJE.id, STRIZENJE.id, FEN.id] });
    await waitFor(() => expectS17Invalidated());
  });

  it("up sends the whole new order", async () => {
    render(<ServicesView />);
    await act(async () => {
      fireEvent.click(button("Premakni gor: Fen"));
    });
    expect(mocks.reorder).toHaveBeenCalledWith({ serviceIds: [STRIZENJE.id, FEN.id, BARVANJE.id] });
  });

  // Flowko U29b (D1 c): the arrows stay off until the refreshed list is in, so a second click never starts
  // from the stale order.
  it("while the list refresh is pending every arrow is off; a double click sends one reorder", async () => {
    let resolveRefresh!: () => void;
    mocks.invalidateList.mockReturnValue(
      new Promise<void>((done) => {
        resolveRefresh = done;
      })
    );
    render(<ServicesView />);
    await act(async () => {
      fireEvent.click(button("Premakni dol: Striženje"));
    });
    await waitFor(() => expect(mocks.invalidateList).toHaveBeenCalled());
    for (const service of ["Striženje", "Barvanje", "Fen"]) {
      expect(button(`Premakni gor: ${service}`)).toBeDisabled();
      expect(button(`Premakni dol: ${service}`)).toBeDisabled();
    }
    fireEvent.click(button("Premakni dol: Striženje"));
    expect(mocks.reorder).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRefresh();
    });
    await waitFor(() => expect(button("Premakni dol: Striženje")).not.toBeDisabled());
  });

  it("a failed reorder turns the arrows back on", async () => {
    mocks.reorder.mockRejectedValue(trpcError("boom", "INTERNAL_SERVER_ERROR"));
    render(<ServicesView />);
    await act(async () => {
      fireEvent.click(button("Premakni dol: Barvanje"));
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(button("Premakni dol: Striženje")).not.toBeDisabled();
  });

  it("a stale list (bad_service) refetches and says the list changed", async () => {
    mocks.reorder.mockRejectedValue(trpcError("bad_service"));
    render(<ServicesView />);
    await act(async () => {
      fireEvent.click(button("Premakni dol: Barvanje"));
    });
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Seznam storitev se je medtem spremenil. Prikazan je trenutni vrstni red; poskusite znova.",
        "error"
      )
    );
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it.each([
    ["forbidden", "FORBIDDEN", "Za to nimate dovoljenja."],
    ["Rate limit exceeded", "TOO_MANY_REQUESTS", "Preveč zahtev. Poskusite znova čez trenutek."],
    ["boom", "INTERNAL_SERVER_ERROR", "Nekaj je šlo narobe."],
  ])("a refused reorder (%s) → its toast", async (message, code, text) => {
    mocks.reorder.mockRejectedValue(trpcError(message, code));
    render(<ServicesView />);
    await act(async () => {
      fireEvent.click(button("Premakni dol: Barvanje"));
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(text, "error"));
  });
});

describe("ServicesView: the sheet", () => {
  it("„Uredi“ opens the sheet with that service", () => {
    render(<ServicesView />);
    fireEvent.click(button("Uredi: Barvanje"));
    expect(screen.getByRole("heading", { name: "Uredi storitev" })).toBeInTheDocument();
    expect((screen.getByLabelText("Ime storitve") as HTMLInputElement).value).toBe("Barvanje");
  });

  it("„Nova storitev“ opens an empty sheet with every ACTIVE member ticked", () => {
    render(<ServicesView />);
    fireEvent.click(button("Nova storitev"));
    expect((screen.getByLabelText("Ime storitve") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("checkbox", { name: "Ana" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bor" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Dan (zaklenjeno)" })).not.toBeChecked();
  });

  it("a save invalidates the S17 queries and closes the sheet", async () => {
    render(<ServicesView />);
    fireEvent.click(button("Uredi: Fen"));
    await act(async () => {
      fireEvent.click(button("Shrani"));
    });
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    await waitFor(() => expectS17Invalidated());
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Uredi storitev" })).toBeNull());
  });

  it("a remove invalidates the S17 queries", async () => {
    render(<ServicesView />);
    fireEvent.click(button("Uredi: Fen"));
    fireEvent.click(button("Odstrani"));
    const dialog = screen.getByRole("dialog", { name: "Odstrani storitev: Fen" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Odstrani" }));
    });
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ serviceId: FEN.id }));
    await waitFor(() => expectS17Invalidated());
  });
});
