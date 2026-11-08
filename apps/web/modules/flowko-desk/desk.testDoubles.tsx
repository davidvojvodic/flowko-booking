// Flowko U28: test doubles for the desk's component tests (not a test file). `@calcom/trpc/react` via
// `vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule)`; the tests drive the
// `deskTrpc` functions (queries return react-query-like objects, mutations resolve or reject `mutateAsync`).
// `DeskTestProvider` gives a sheet the desk context (Olga at the desk, Monday 2026-11-16) with spies.
import type { ReactNode } from "react";
import { vi } from "vitest";

import type { DeskContextValue } from "./DeskContext";
import { DeskContext } from "./DeskContext";
import { DATE, OLGA, deskView, members, services } from "./desk.fixture";
import type { DeskActorState } from "./useDeskActor";
import type { MoveModeState } from "./useMoveMode";

export const deskTrpc = {
  dayQuery: vi.fn(),
  weekQuery: vi.fn(),
  membersQuery: vi.fn(),
  servicesQuery: vi.fn(),
  freeStartsQuery: vi.fn(),
  customersQuery: vi.fn(),
  create: vi.fn(),
  move: vi.fn(),
  cancel: vi.fn(),
  noShow: vi.fn(),
  invalidateDay: vi.fn(),
  invalidateWeek: vi.fn(),
};

/** Defaults: members + services answered, no free starts, no customers, every write rejects until a test says. */
export function resetDeskTrpc() {
  Object.values(deskTrpc).forEach((fn) => fn.mockReset());
  deskTrpc.weekQuery.mockReturnValue({
    data: undefined,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
    isPending: true,
    error: null,
  });
  deskTrpc.membersQuery.mockReturnValue({ data: members });
  deskTrpc.servicesQuery.mockReturnValue({ data: services });
  deskTrpc.freeStartsQuery.mockReturnValue({ data: undefined, isFetching: false });
  deskTrpc.customersQuery.mockReturnValue({ data: undefined, isFetching: false });
  deskTrpc.invalidateDay.mockResolvedValue(undefined);
  deskTrpc.invalidateWeek.mockResolvedValue(undefined);
}

/** A TRPCClientError as the desk sees it: `message` is the Flowko code, `data.code` the tRPC code. */
export function trpcError(code: string, trpcCode = "BAD_REQUEST") {
  return Object.assign(new Error(code), { data: { code: trpcCode } });
}

const mutation = (fn: (input: unknown) => unknown) => () => ({ mutateAsync: fn, isPending: false });

export const trpcModule = {
  trpc: {
    useUtils: () => ({
      viewer: {
        flowko: {
          bookings: {
            day: { invalidate: deskTrpc.invalidateDay },
            week: { invalidate: deskTrpc.invalidateWeek },
          },
        },
      },
    }),
    viewer: {
      flowko: {
        bookings: {
          day: { useQuery: (...args: unknown[]) => deskTrpc.dayQuery(...args) },
          week: { useQuery: (...args: unknown[]) => deskTrpc.weekQuery(...args) },
          freeStarts: { useQuery: (...args: unknown[]) => deskTrpc.freeStartsQuery(...args) },
          customers: { useQuery: (...args: unknown[]) => deskTrpc.customersQuery(...args) },
          create: { useMutation: mutation((input) => deskTrpc.create(input)) },
          move: { useMutation: mutation((input) => deskTrpc.move(input)) },
          cancel: { useMutation: mutation((input) => deskTrpc.cancel(input)) },
          noShow: { useMutation: mutation((input) => deskTrpc.noShow(input)) },
        },
        business: {
          members: { useQuery: (...args: unknown[]) => deskTrpc.membersQuery(...args) },
          services: { useQuery: (...args: unknown[]) => deskTrpc.servicesQuery(...args) },
        },
      },
    },
  },
};

export function actorState(over: Partial<DeskActorState> = {}): DeskActorState {
  return {
    actor: { memberId: OLGA, displayName: "Olga" },
    fixed: false,
    needsChoice: false,
    choices: members,
    choose: vi.fn(),
    clear: vi.fn(),
    pickerOpen: false,
    openPicker: vi.fn(),
    closePicker: vi.fn(),
    ...over,
  };
}

export function moveModeState(over: Partial<MoveModeState> = {}): MoveModeState {
  return {
    moving: null,
    start: vi.fn(),
    stop: vi.fn(),
    tap: vi.fn(),
    moveTo: vi.fn().mockResolvedValue({ kind: "done", result: { status: "moved" } }),
    confirm: null,
    confirmOverride: vi.fn(),
    dismissConfirm: vi.fn(),
    ...over,
  };
}

export function contextValue(over: Partial<DeskContextValue> = {}): DeskContextValue {
  return {
    date: DATE,
    view: deskView(),
    actor: actorState(),
    refetch: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(undefined),
    bookTarget: null,
    setBookTarget: vi.fn(),
    detailsBookingId: null,
    setDetailsBookingId: vi.fn(),
    moveMode: moveModeState(),
    reenterFrom: null,
    setReenterFrom: vi.fn(),
    ...over,
  };
}

export function DeskTestProvider(props: { value: DeskContextValue; children: ReactNode }) {
  return <DeskContext.Provider value={props.value}>{props.children}</DeskContext.Provider>;
}
