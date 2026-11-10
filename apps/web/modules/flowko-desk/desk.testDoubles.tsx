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
  // Flowko U28b (B3): free starts are refreshed after every desk write and before a dialog.
  invalidateFreeStarts: vi.fn(),
  refetchFreeStarts: vi.fn(),
  refetchMe: vi.fn(),
  // Flowko U29a (S7): the desk's business.me poll (useDeskBusinessMePoll); the desk reads `me` via useFlowkoBusiness.
  meQuery: vi.fn(),
  // Flowko U29b: Urnik's read, writes and refreshes (DeskView calls the roster hooks in every view).
  rosterWeekQuery: vi.fn(),
  saveWeek: vi.fn(),
  saveUsualWeeks: vi.fn(),
  addAbsence: vi.fn(),
  removeAbsence: vi.fn(),
  setHolidayOpen: vi.fn(),
  invalidateRosterWeek: vi.fn(),
  fetchRosterWeek: vi.fn(),
  invalidateSettings: vi.fn(),
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
  deskTrpc.invalidateFreeStarts.mockResolvedValue(undefined);
  deskTrpc.refetchFreeStarts.mockResolvedValue(undefined);
  deskTrpc.refetchMe.mockResolvedValue(undefined);
  deskTrpc.meQuery.mockReturnValue({ data: undefined });
  // Flowko U29b: roster.week pending (a test answers it), its refreshes resolve.
  deskTrpc.rosterWeekQuery.mockReturnValue({
    data: undefined,
    isPending: true,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
  });
  deskTrpc.invalidateRosterWeek.mockResolvedValue(undefined);
  deskTrpc.invalidateSettings.mockResolvedValue(undefined);
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
            freeStarts: { invalidate: deskTrpc.invalidateFreeStarts, refetch: deskTrpc.refetchFreeStarts },
          },
          business: {
            me: { refetch: deskTrpc.refetchMe },
            // Flowko U29b: a holiday change refreshes the settings too (S16).
            settings: { invalidate: deskTrpc.invalidateSettings },
          },
          // Flowko U29b: Urnik refreshes its week; „Kopiraj prejšnji teden“ fetches the week before (S15).
          roster: {
            week: {
              invalidate: deskTrpc.invalidateRosterWeek,
              fetch: (...args: unknown[]) => deskTrpc.fetchRosterWeek(...args),
            },
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
          me: { useQuery: (...args: unknown[]) => deskTrpc.meQuery(...args) },
        },
        // Flowko U29b: Urnik (roster.week + the writes it uses).
        roster: {
          week: { useQuery: (...args: unknown[]) => deskTrpc.rosterWeekQuery(...args) },
          saveWeek: { useMutation: mutation((input) => deskTrpc.saveWeek(input)) },
          saveUsualWeeks: { useMutation: mutation((input) => deskTrpc.saveUsualWeeks(input)) },
          addAbsence: { useMutation: mutation((input) => deskTrpc.addAbsence(input)) },
          removeAbsence: { useMutation: mutation((input) => deskTrpc.removeAbsence(input)) },
          setHolidayOpen: { useMutation: mutation((input) => deskTrpc.setHolidayOpen(input)) },
        },
      },
    },
  },
};

export function actorState(over: Partial<DeskActorState> = {}): DeskActorState {
  return {
    actor: { memberId: OLGA, displayName: "Olga" },
    fixed: false,
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
