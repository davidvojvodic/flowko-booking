-- Flowko U22: claim table for the customer reminder e-mails sent by /api/cron/attendeeReminder. One row per
-- (booking, reminder offset in minutes), inserted with ON CONFLICT DO NOTHING before the send, so a booking is
-- never mailed twice for the same offset (the unique index is the guard). Rows cascade with their booking.
-- Additive only: no existing table or row is changed. To remove it, a later migration runs
--   DROP TABLE IF EXISTS "public"."FlowkoAttendeeReminder";
-- and the same change deletes the FlowkoAttendeeReminder model and the Booking.flowkoAttendeeReminders
-- back-relation from schema.prisma.

-- CreateTable
CREATE TABLE "public"."FlowkoAttendeeReminder" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowkoAttendeeReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FlowkoAttendeeReminder_bookingId_offsetMinutes_key" ON "public"."FlowkoAttendeeReminder"("bookingId", "offsetMinutes");

-- AddForeignKey
ALTER TABLE "public"."FlowkoAttendeeReminder" ADD CONSTRAINT "FlowkoAttendeeReminder_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
