-- Flowko U29a: owner settings on FlowkoBusiness. "email" = the Reply-To of customer mails (NULL = none),
-- "sharedDevice" = whether the desk shows the „Ste: …“ chip (off by default), "reminderOffsets" = the reminder
-- e-mail choice in minutes before a booking ('{}' = reminders off, default '{1440}' = 24 hours before, today's
-- behaviour). The body up to the hand SQL is the offline `prisma migrate diff` output; the two CHECKs below it are
-- hand-written (Prisma cannot express them; NOT NULL on the scalar list lives in the CHECK, as `migrate diff`
-- writes a scalar list SQL-nullable).
-- Additive only: three new columns with defaults or NULL; no existing column or row is changed (existing
-- businesses get sharedDevice false, reminderOffsets '{1440}', email NULL).
-- To remove it, a later migration runs:
--   ALTER TABLE "FlowkoBusiness" DROP CONSTRAINT "FlowkoBusiness_reminderOffsets_choice",
--     DROP CONSTRAINT "FlowkoBusiness_email_length",
--     DROP COLUMN "reminderOffsets", DROP COLUMN "sharedDevice", DROP COLUMN "email";
-- and the same change deletes the `// Flowko U29a:` block (email, sharedDevice, reminderOffsets) on
-- FlowkoBusiness from schema.prisma.

-- AlterTable
ALTER TABLE "public"."FlowkoBusiness" ADD COLUMN     "email" TEXT,
ADD COLUMN     "reminderOffsets" INTEGER[] DEFAULT ARRAY[1440]::INTEGER[],
ADD COLUMN     "sharedDevice" BOOLEAN NOT NULL DEFAULT false;


-- AddCheckConstraint: the business e-mail is unset or at most 254 characters
ALTER TABLE "public"."FlowkoBusiness" ADD CONSTRAINT "FlowkoBusiness_email_length" CHECK ("email" IS NULL OR char_length("email") <= 254);

-- AddCheckConstraint: the reminder choice is never NULL and one of the four U22 choices, in one canonical order
-- (no duplicates): none, 24 hours, 2 hours, 24 hours and 2 hours
ALTER TABLE "public"."FlowkoBusiness" ADD CONSTRAINT "FlowkoBusiness_reminderOffsets_choice" CHECK ("reminderOffsets" IS NOT NULL AND "reminderOffsets" IN ('{}'::int[], '{1440}'::int[], '{120}'::int[], '{1440,120}'::int[]));
