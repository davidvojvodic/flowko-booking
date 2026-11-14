// Flowko U28: the desk's writes (R9, R13): the actor goes with every write, the picker opens first when nobody is
// chosen, `needs_confirm` and every error refetch the day before anything shows, each error code has its own text,
// `forbidden` clears the stored actor and reopens the picker.
// Flowko U28b (B1, B3): no picker is ever forced open (a `forbidden` answer clears the stored choice and shows its
// text); the refetch before a dialog or a message refreshes the shown free starts too.
// Flowko U29e (E6, R10): cancel passes the hand-over marker only when given.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BOR, iso, localeT } from "./desk.fixture";
import { actorState, deskTrpc, resetDeskTrpc, trpcError } from "./desk.testDoubles";
import { deskErrorCode, useDeskWrites } from "./useDeskWrites";

vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule);
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));
const toast = vi.fn();
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => toast(...args) }));

const log: string[] = [];
function setup(actor = actorState()) {
  const refetch = vi.fn(async () => {
    log.push("refetch");
  });
  const invalidate = vi.fn(async () => {
    log.push("invalidate");
  });
  const { result } = renderHook(() => useDeskWrites({ actor, refetch, invalidate }));
  return { writes: () => result.current, refetch, invalidate, actor };
}

const createInput = {
  workerMemberId: BOR,
  serviceIds: [3, 2],
  start: iso("13:30"),
  customer: { name: "Marija Novak", phone: "041 123 456", email: null },
};

describe("useDeskWrites (U28 R9, R13)", () => {
  beforeEach(() => {
    resetDeskTrpc();
    toast.mockReset();
    log.length = 0;
  });

  it("create sends the actor with the payload; created → toast and invalidate", async () => {
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 7, uid: "u" });
    const { writes, invalidate } = setup();
    let outcome: unknown;
    await act(async () => {
      outcome = await writes().create(createInput);
    });
    expect(deskTrpc.create).toHaveBeenCalledWith({
      ...createInput,
      confirmOverride: false,
      actorMemberId: 1,
    });
    expect(outcome).toMatchObject({ kind: "done" });
    expect(invalidate).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Termin je shranjen.", "success");
  });

  it("needs_confirm refetches the day before it returns the problems", async () => {
    const problems = [{ kind: "outside_shift", step: 0 }];
    deskTrpc.create.mockImplementation(async () => {
      log.push("create");
      return { status: "needs_confirm", problems, googleUnavailable: false };
    });
    const { writes } = setup();
    let outcome: unknown;
    await act(async () => {
      outcome = await writes().create(createInput);
      log.push("returned");
    });
    expect(log).toEqual(["create", "refetch", "returned"]);
    expect(outcome).toEqual({ kind: "confirm", problems, googleUnavailable: false });
    expect(toast).not.toHaveBeenCalled();
  });

  it("with the actor not known yet (member list loading) sends nothing and opens no picker", async () => {
    const actor = actorState({ actor: null });
    const { writes } = setup(actor);
    let outcome: unknown;
    await act(async () => {
      outcome = await writes().cancel({ bookingId: 101 });
    });
    expect(outcome).toEqual({ kind: "needs_actor" });
    expect(actor.openPicker).not.toHaveBeenCalled();
    expect(deskTrpc.cancel).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Koledarja ni bilo mogoče naložiti.", "error");
  });

  it("needs_confirm and errors refetch the shown free starts with the day (B3)", async () => {
    deskTrpc.create.mockResolvedValueOnce({
      status: "needs_confirm",
      problems: [],
      googleUnavailable: false,
    });
    deskTrpc.create.mockRejectedValueOnce(trpcError("duplicate_time"));
    const { writes, refetch } = setup();
    await act(async () => {
      await writes().create(createInput);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(deskTrpc.refetchFreeStarts).toHaveBeenCalledTimes(1);
    await act(async () => {
      await writes().create(createInput);
    });
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(deskTrpc.refetchFreeStarts).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["duplicate_time", "Ta termin je bil pravkar že shranjen."],
    ["booking_not_active", "Ta termin ni več aktiven."],
    ["worker_locked", "Ta delavec je zaklenjen."],
    ["service_not_assigned", "Delavec ne opravlja ene od izbranih storitev."],
    ["bad_booking", "Tega termina ni mogoče spremeniti."],
    ["booking_not_started", "Neprihoda ni mogoče označiti pred začetkom termina."],
    ["in_past", "Termin je v preteklosti. Izberite poznejši čas."],
    ["bad_customer", "Preverite podatke stranke: ime ter veljavna telefonska številka ali e-pošta."],
  ])("%s → refetch, then its own text", async (code, text) => {
    deskTrpc.move.mockImplementation(async () => {
      log.push("move");
      throw trpcError(code);
    });
    toast.mockImplementation(() => log.push("toast"));
    const { writes } = setup();
    let outcome: unknown;
    await act(async () => {
      outcome = await writes().move({ bookingId: 101, start: iso("11:00") });
    });
    expect(log).toEqual(["move", "refetch", "toast"]);
    expect(toast).toHaveBeenCalledWith(text, "error");
    expect(outcome).toEqual({ kind: "error", code, message: `flowko_desk_error_${code}` });
  });

  it("TOO_MANY_REQUESTS (the rate limiter) has its own text", async () => {
    deskTrpc.noShow.mockRejectedValue(
      trpcError("Rate limit exceeded. Try again in 42 seconds.", "TOO_MANY_REQUESTS")
    );
    const { writes, refetch } = setup();
    await act(async () => {
      await writes().noShow({ bookingId: 101, noShow: true });
    });
    expect(refetch).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Preveč zahtev. Poskusite znova čez trenutek.", "error");
  });

  it("a field code is returned without a toast", async () => {
    deskTrpc.create.mockRejectedValue(trpcError("in_past"));
    const { writes, refetch } = setup();
    let outcome: unknown;
    await act(async () => {
      outcome = await writes().create(createInput, { fieldCodes: ["in_past", "bad_customer"] });
    });
    expect(refetch).toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: "error", code: "in_past" });
  });

  it("forbidden clears the stored actor and shows its text, no picker (B1)", async () => {
    deskTrpc.cancel.mockRejectedValue(trpcError("forbidden", "FORBIDDEN"));
    const { writes, actor } = setup();
    await act(async () => {
      await writes().cancel({ bookingId: 101, reason: "x" });
    });
    expect(deskTrpc.cancel).toHaveBeenCalledWith({ bookingId: 101, reason: "x", actorMemberId: 1 });
    expect(actor.clear).toHaveBeenCalled();
    expect(actor.openPicker).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      "Za to nimate dovoljenja. Izbira osebe je ponastavljena; poskusite znova.",
      "error"
    );
  });

  it("forbidden for a fixed WORKER does not ask her to choose who she is", async () => {
    deskTrpc.create.mockRejectedValue(trpcError("forbidden", "FORBIDDEN"));
    const { writes } = setup(actorState({ actor: { memberId: 2, displayName: "Ana" }, fixed: true }));
    let outcome: unknown;
    await act(async () => {
      outcome = await writes().create(createInput);
    });
    expect(toast).toHaveBeenCalledWith("Za to nimate dovoljenja. Urejate lahko samo svoje termine.", "error");
    expect(outcome).toMatchObject({ code: "forbidden", message: "flowko_desk_error_forbidden_self" });
  });

  it("an unknown failure says something went wrong", async () => {
    deskTrpc.cancel.mockRejectedValue(new Error("boom"));
    const { writes } = setup();
    await act(async () => {
      await writes().cancel({ bookingId: 101 });
    });
    expect(toast).toHaveBeenCalledWith("Nekaj je šlo narobe.", "error");
  });

  it("toasts: none shows no toast at all; errors shows only errors", async () => {
    deskTrpc.cancel.mockResolvedValue({ status: "cancelled" });
    const { writes, invalidate } = setup();
    await act(async () => {
      await writes().cancel({ bookingId: 101 }, { toasts: "none" });
      await writes().cancel({ bookingId: 101 }, { toasts: "errors" });
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(toast).not.toHaveBeenCalled();
    deskTrpc.cancel.mockRejectedValue(trpcError("bad_booking"));
    await act(async () => {
      await writes().cancel({ bookingId: 101 }, { toasts: "none" });
    });
    expect(toast).not.toHaveBeenCalled();
    await act(async () => {
      await writes().cancel({ bookingId: 101 }, { toasts: "errors" });
    });
    expect(toast).toHaveBeenCalledWith("Tega termina ni mogoče spremeniti.", "error");
  });

  it("no-show success texts follow the value", async () => {
    deskTrpc.noShow.mockResolvedValue({ status: "updated", noShow: true });
    const { writes } = setup();
    await act(async () => {
      await writes().noShow({ bookingId: 101, noShow: true });
    });
    expect(toast).toHaveBeenLastCalledWith("Označeno kot neprihod.", "success");
    await act(async () => {
      await writes().noShow({ bookingId: 101, noShow: false });
    });
    expect(toast).toHaveBeenLastCalledWith("Oznaka neprihoda je odstranjena.", "success");
  });

  it("deskErrorCode reads the Flowko code, then the tRPC code", () => {
    expect(deskErrorCode(trpcError("worker_locked"))).toBe("worker_locked");
    expect(deskErrorCode(trpcError("Rate limit", "TOO_MANY_REQUESTS"))).toBe("TOO_MANY_REQUESTS");
    expect(deskErrorCode(new Error("nope"))).toBe("unknown");
    expect(deskErrorCode(null)).toBe("unknown");
  });
});

describe("useDeskWrites cancel with the hand-over marker (U29e E6, R10)", () => {
  beforeEach(() => {
    resetDeskTrpc();
    toast.mockReset();
    log.length = 0;
  });

  it("sends handoverToMemberId when given, and no such key otherwise", async () => {
    deskTrpc.cancel.mockResolvedValue({ status: "cancelled" });
    const { writes } = setup();
    await act(async () => {
      await writes().cancel({ bookingId: 101, reason: "Prestavljeno k: Bor", handoverToMemberId: BOR });
      await writes().cancel({ bookingId: 102, reason: null });
    });
    expect(deskTrpc.cancel.mock.calls[0][0]).toEqual({
      bookingId: 101,
      reason: "Prestavljeno k: Bor",
      handoverToMemberId: BOR,
      actorMemberId: 1,
    });
    expect(deskTrpc.cancel.mock.calls[1][0]).toEqual({ bookingId: 102, reason: null, actorMemberId: 1 });
    expect(Object.keys(deskTrpc.cancel.mock.calls[1][0])).not.toContain("handoverToMemberId");
  });
});
