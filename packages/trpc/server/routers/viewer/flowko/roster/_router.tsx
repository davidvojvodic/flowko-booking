// Flowko U26: viewer.flowko.roster.* (pattern: viewer.ooo, lazy handler import). Rights live in the services.
import authedProcedure from "../../../../procedures/authedProcedure";
import { router } from "../../../../trpc";
import {
  ZAddAbsenceInput,
  ZCopyWeekInput,
  ZRemoveAbsenceInput,
  ZRosterWeekInput,
  ZSetHolidayOpenInput,
  ZSetHolidaysClosedInput,
  ZSetUsualWeekInput,
  ZSetWeekInput,
} from "./roster.schema";

const load = () => import("./roster.handler");

export const rosterRouter = router({
  week: authedProcedure.input(ZRosterWeekInput).query(async ({ ctx, input }) => {
    return (await load()).weekHandler({ ctx, input });
  }),
  setUsualWeek: authedProcedure.input(ZSetUsualWeekInput).mutation(async ({ ctx, input }) => {
    return (await load()).setUsualWeekHandler({ ctx, input });
  }),
  setWeek: authedProcedure.input(ZSetWeekInput).mutation(async ({ ctx, input }) => {
    return (await load()).setWeekHandler({ ctx, input });
  }),
  copyWeek: authedProcedure.input(ZCopyWeekInput).mutation(async ({ ctx, input }) => {
    return (await load()).copyWeekHandler({ ctx, input });
  }),
  addAbsence: authedProcedure.input(ZAddAbsenceInput).mutation(async ({ ctx, input }) => {
    return (await load()).addAbsenceHandler({ ctx, input });
  }),
  removeAbsence: authedProcedure.input(ZRemoveAbsenceInput).mutation(async ({ ctx, input }) => {
    return (await load()).removeAbsenceHandler({ ctx, input });
  }),
  setHolidaysClosed: authedProcedure.input(ZSetHolidaysClosedInput).mutation(async ({ ctx, input }) => {
    return (await load()).setHolidaysClosedHandler({ ctx, input });
  }),
  setHolidayOpen: authedProcedure.input(ZSetHolidayOpenInput).mutation(async ({ ctx, input }) => {
    return (await load()).setHolidayOpenHandler({ ctx, input });
  }),
});
