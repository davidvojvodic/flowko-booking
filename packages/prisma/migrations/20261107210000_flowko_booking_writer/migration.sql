-- Flowko U27: booking writer. FlowkoWorkerMirror links each business worker (FlowkoBusinessMember) to one hidden
-- "mirror" EventType and one empty Schedule, the Cal rows that let Cal's own booking checks see the worker; plus
-- three indexes on the U25 booking tables for their SET NULL foreign keys (FlowkoBookingStep."serviceId",
-- FlowkoBookingAction."userId" and "actorMemberId"). The whole file is the offline `prisma migrate diff` output;
-- there is no hand SQL.
-- Additive only: one new table and three new indexes; no existing column or row is changed (EventType, Schedule,
-- FlowkoBusiness and FlowkoBusinessMember only gain incoming foreign keys).
-- To remove it, a later migration runs, in this order:
--   DROP TABLE "FlowkoWorkerMirror";
--   DROP INDEX "FlowkoBookingAction_actorMemberId_idx";
--   DROP INDEX "FlowkoBookingAction_userId_idx";
--   DROP INDEX "FlowkoBookingStep_serviceId_idx";
-- and the same change deletes the Flowko U27 model, the `// Flowko U27:` blocks and the three @@index lines from
-- schema.prisma and the `flowkoMirror` key from _eventTypeMetaDataSchemaWithoutApps in zod-utils.ts.

-- CreateTable
CREATE TABLE "public"."FlowkoWorkerMirror" (
    "id" SERIAL NOT NULL,
    "businessId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "eventTypeId" INTEGER NOT NULL,
    "scheduleId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowkoWorkerMirror_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FlowkoWorkerMirror_memberId_key" ON "public"."FlowkoWorkerMirror"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowkoWorkerMirror_eventTypeId_key" ON "public"."FlowkoWorkerMirror"("eventTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowkoWorkerMirror_scheduleId_key" ON "public"."FlowkoWorkerMirror"("scheduleId");

-- CreateIndex
CREATE INDEX "FlowkoWorkerMirror_businessId_idx" ON "public"."FlowkoWorkerMirror"("businessId");

-- CreateIndex
CREATE INDEX "FlowkoBookingStep_serviceId_idx" ON "public"."FlowkoBookingStep"("serviceId");

-- CreateIndex
CREATE INDEX "FlowkoBookingAction_userId_idx" ON "public"."FlowkoBookingAction"("userId");

-- CreateIndex
CREATE INDEX "FlowkoBookingAction_actorMemberId_idx" ON "public"."FlowkoBookingAction"("actorMemberId");

-- AddForeignKey
ALTER TABLE "public"."FlowkoWorkerMirror" ADD CONSTRAINT "FlowkoWorkerMirror_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."FlowkoBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoWorkerMirror" ADD CONSTRAINT "FlowkoWorkerMirror_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."FlowkoBusinessMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoWorkerMirror" ADD CONSTRAINT "FlowkoWorkerMirror_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "public"."EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoWorkerMirror" ADD CONSTRAINT "FlowkoWorkerMirror_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "public"."Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
