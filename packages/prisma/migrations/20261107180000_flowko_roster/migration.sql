-- Flowko U26: roster. A member's usual week (FlowkoBusinessMember."usualWeek"), week changes per member and date
-- (FlowkoRosterDay), absences (FlowkoAbsence) and the business holiday settings (FlowkoBusiness."holidaysClosed",
-- "openHolidays"). The body up to the hand SQL is the offline `prisma migrate diff` output; the three CHECKs below it
-- are hand-written (Prisma cannot express them).
-- Additive only: two new tables and three new columns with defaults or NULL; no existing column or row is changed
-- (FlowkoBusinessMember and users only gain incoming foreign keys).
-- To remove it, a later migration runs, in this order:
--   DROP TABLE "FlowkoAbsence";
--   DROP TABLE "FlowkoRosterDay";
--   ALTER TABLE "FlowkoBusinessMember" DROP COLUMN "usualWeek";
--   ALTER TABLE "FlowkoBusiness" DROP COLUMN "openHolidays", DROP COLUMN "holidaysClosed";
-- and the same change deletes the two Flowko U26 models and the `// Flowko U26:` blocks on FlowkoBusiness,
-- FlowkoBusinessMember and User from schema.prisma.

-- AlterTable
ALTER TABLE "public"."FlowkoBusiness" ADD COLUMN     "holidaysClosed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "openHolidays" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "public"."FlowkoBusinessMember" ADD COLUMN     "usualWeek" JSONB;

-- CreateTable
CREATE TABLE "public"."FlowkoRosterDay" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "shifts" JSONB NOT NULL,
    "updatedByUserId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowkoRosterDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FlowkoAbsence" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowkoAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FlowkoRosterDay_memberId_date_key" ON "public"."FlowkoRosterDay"("memberId", "date");

-- CreateIndex
CREATE INDEX "FlowkoAbsence_memberId_startDate_idx" ON "public"."FlowkoAbsence"("memberId", "startDate");

-- AddForeignKey
ALTER TABLE "public"."FlowkoRosterDay" ADD CONSTRAINT "FlowkoRosterDay_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."FlowkoBusinessMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoRosterDay" ADD CONSTRAINT "FlowkoRosterDay_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoAbsence" ADD CONSTRAINT "FlowkoAbsence_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."FlowkoBusinessMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoAbsence" ADD CONSTRAINT "FlowkoAbsence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddCheckConstraint: an absence ends on or after its start and spans at most 365 days
ALTER TABLE "public"."FlowkoAbsence" ADD CONSTRAINT "FlowkoAbsence_dates_range" CHECK ("endDate" >= "startDate" AND "endDate" - "startDate" <= 365);

-- AddCheckConstraint: a week change's shifts are a JSON array ([] = not working that day)
ALTER TABLE "public"."FlowkoRosterDay" ADD CONSTRAINT "FlowkoRosterDay_shifts_array" CHECK (jsonb_typeof("shifts") = 'array');

-- AddCheckConstraint: a usual week is unset or a JSON object
ALTER TABLE "public"."FlowkoBusinessMember" ADD CONSTRAINT "FlowkoBusinessMember_usualWeek_object" CHECK ("usualWeek" IS NULL OR jsonb_typeof("usualWeek") = 'object');
