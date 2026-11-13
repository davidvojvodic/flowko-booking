-- Flowko U29d: invites. "revokedAt" = the owner revoked the invite (the row stays, the link is dead); "memberId" =
-- the desk-only member this invite turns into a login (NULL = a brand-new member is created at accept). "Open" =
-- neither used nor revoked (expired or not; expiry cannot sit in a partial index). The body up to the hand SQL is
-- the offline `prisma migrate diff` output; the six CHECKs and the two partial unique indexes below it are
-- hand-written (Prisma cannot express them). They close what the U25 table left open: an OWNER invite, a member
-- link on STAFF, a mixed-case or empty e-mail, an empty name, a row both used and revoked, a token hash that is
-- not sha256 hex, and several open invites for one person or one member.
-- Additive only: two new nullable columns; the table has no writer before U29d (0 rows expected on prod: the
-- release counts them before this migration, and every constraint below applies cleanly to an empty table).
-- To remove it, a later migration runs:
--   DROP INDEX "public"."FlowkoBusinessInvite_one_open_per_member";
--   DROP INDEX "public"."FlowkoBusinessInvite_one_open_per_email";
--   ALTER TABLE "public"."FlowkoBusinessInvite" DROP CONSTRAINT "FlowkoBusinessInvite_tokenHash_sha256",
--     DROP CONSTRAINT "FlowkoBusinessInvite_used_or_revoked",
--     DROP CONSTRAINT "FlowkoBusinessInvite_name_length",
--     DROP CONSTRAINT "FlowkoBusinessInvite_email_lower",
--     DROP CONSTRAINT "FlowkoBusinessInvite_member_is_worker",
--     DROP CONSTRAINT "FlowkoBusinessInvite_role_not_owner",
--     DROP CONSTRAINT "FlowkoBusinessInvite_memberId_fkey";
--   DROP INDEX "public"."FlowkoBusinessInvite_memberId_idx";
--   ALTER TABLE "public"."FlowkoBusinessInvite" DROP COLUMN "memberId", DROP COLUMN "revokedAt";
-- and the same change deletes the `// Flowko U29d:` block (revokedAt, memberId, member) on FlowkoBusinessInvite,
-- the `invites` back-relation on FlowkoBusinessMember and `@@index([memberId])` from schema.prisma.

-- AlterTable
ALTER TABLE "public"."FlowkoBusinessInvite" ADD COLUMN     "memberId" INTEGER,
ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FlowkoBusinessInvite_memberId_idx" ON "public"."FlowkoBusinessInvite"("memberId");

-- AddForeignKey
ALTER TABLE "public"."FlowkoBusinessInvite" ADD CONSTRAINT "FlowkoBusinessInvite_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."FlowkoBusinessMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddCheckConstraint: an invite is for a WORKER or STAFF, never an OWNER
ALTER TABLE "public"."FlowkoBusinessInvite" ADD CONSTRAINT "FlowkoBusinessInvite_role_not_owner" CHECK ("role" IN ('WORKER', 'STAFF'));

-- AddCheckConstraint: only a WORKER invite can name a member (the desk-only conversion)
ALTER TABLE "public"."FlowkoBusinessInvite" ADD CONSTRAINT "FlowkoBusinessInvite_member_is_worker" CHECK ("memberId" IS NULL OR "role" = 'WORKER');

-- AddCheckConstraint: the e-mail is stored lower case and is 3 to 254 characters
ALTER TABLE "public"."FlowkoBusinessInvite" ADD CONSTRAINT "FlowkoBusinessInvite_email_lower" CHECK ("email" = lower("email") AND char_length("email") BETWEEN 3 AND 254);

-- AddCheckConstraint: the invitee's name is 1 to 80 characters (the member display name rule)
ALTER TABLE "public"."FlowkoBusinessInvite" ADD CONSTRAINT "FlowkoBusinessInvite_name_length" CHECK (char_length("name") BETWEEN 1 AND 80);

-- AddCheckConstraint: an invite is never both used and revoked
ALTER TABLE "public"."FlowkoBusinessInvite" ADD CONSTRAINT "FlowkoBusinessInvite_used_or_revoked" CHECK ("usedAt" IS NULL OR "revokedAt" IS NULL);

-- AddCheckConstraint: only the sha256 of the token is stored (64 lower-case hex characters)
ALTER TABLE "public"."FlowkoBusinessInvite" ADD CONSTRAINT "FlowkoBusinessInvite_tokenHash_sha256" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

-- CreateIndex: one open invite per business and e-mail
CREATE UNIQUE INDEX "FlowkoBusinessInvite_one_open_per_email" ON "public"."FlowkoBusinessInvite"("businessId", "email") WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;

-- CreateIndex: one open invite per desk-only member
CREATE UNIQUE INDEX "FlowkoBusinessInvite_one_open_per_member" ON "public"."FlowkoBusinessInvite"("memberId") WHERE "memberId" IS NOT NULL AND "usedAt" IS NULL AND "revokedAt" IS NULL;
