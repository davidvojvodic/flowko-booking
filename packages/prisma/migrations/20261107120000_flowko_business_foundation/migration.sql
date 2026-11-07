-- Flowko U25: business foundation. Tables for a business (salon, studio, ...), its members (owner, workers,
-- staff), invites (table only, U29 writes it), services, which member performs which service, the per-booking
-- step copy (written by U27) and the business action log, plus their four enums. The body up to the hand SQL
-- is the offline `prisma migrate diff` output; the CHECKs and the one-owner partial unique index below it are
-- hand-written (Prisma cannot express them).
-- Additive only: no existing table, column or row is changed (users and Booking only gain incoming foreign keys).
-- To remove it, a later migration runs, in this order:
--   DROP TABLE IF EXISTS "public"."FlowkoBookingAction";
--   DROP TABLE IF EXISTS "public"."FlowkoBookingStep";
--   DROP TABLE IF EXISTS "public"."FlowkoServiceWorker";
--   DROP TABLE IF EXISTS "public"."FlowkoService";
--   DROP TABLE IF EXISTS "public"."FlowkoBusinessInvite";
--   DROP TABLE IF EXISTS "public"."FlowkoBusinessMember";
--   DROP TABLE IF EXISTS "public"."FlowkoBusiness";
--   DROP TYPE IF EXISTS "public"."FlowkoBookingActionKind";
--   DROP TYPE IF EXISTS "public"."FlowkoStepKind";
--   DROP TYPE IF EXISTS "public"."FlowkoMemberStatus";
--   DROP TYPE IF EXISTS "public"."FlowkoBusinessRole";
-- and the same change deletes the seven Flowko U25 models, the four enums and the `// Flowko U25:` back-relation
-- blocks on User and Booking from schema.prisma.

-- CreateEnum
CREATE TYPE "public"."FlowkoBusinessRole" AS ENUM ('OWNER', 'WORKER', 'STAFF');

-- CreateEnum
CREATE TYPE "public"."FlowkoMemberStatus" AS ENUM ('ACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "public"."FlowkoStepKind" AS ENUM ('busy', 'processing');

-- CreateEnum
CREATE TYPE "public"."FlowkoBookingActionKind" AS ENUM ('CREATED', 'CANCELLED', 'RESCHEDULED', 'CONFIRMED', 'DECLINED', 'NO_SHOW', 'LOCATION_CHANGED', 'GUESTS_ADDED');

-- CreateTable
CREATE TABLE "public"."FlowkoBusiness" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Ljubljana',
    "phone" TEXT,
    "address" TEXT,
    "logoUrl" TEXT,
    "brandColor" TEXT,
    "darkBrandColor" TEXT,
    "websiteUrl" TEXT,
    "instagramHandle" TEXT,
    "openingHours" JSONB NOT NULL,
    "slotGridMinutes" INTEGER NOT NULL DEFAULT 15,
    "showPrices" BOOLEAN NOT NULL DEFAULT false,
    "selfCancelHours" INTEGER NOT NULL DEFAULT 24,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowkoBusiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FlowkoBusinessMember" (
    "id" SERIAL NOT NULL,
    "businessId" INTEGER NOT NULL,
    "userId" INTEGER,
    "role" "public"."FlowkoBusinessRole" NOT NULL,
    "status" "public"."FlowkoMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "lockedAt" TIMESTAMP(3),
    "displayName" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowkoBusinessMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FlowkoBusinessInvite" (
    "id" SERIAL NOT NULL,
    "businessId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "public"."FlowkoBusinessRole" NOT NULL DEFAULT 'WORKER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowkoBusinessInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FlowkoService" (
    "id" SERIAL NOT NULL,
    "businessId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "steps" JSONB NOT NULL,
    "priceCents" INTEGER,
    "onlineBookable" BOOLEAN NOT NULL DEFAULT true,
    "slotGridMinutes" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowkoService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FlowkoServiceWorker" (
    "serviceId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowkoServiceWorker_pkey" PRIMARY KEY ("serviceId","memberId")
);

-- CreateTable
CREATE TABLE "public"."FlowkoBookingStep" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" "public"."FlowkoStepKind" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "serviceId" INTEGER,
    "serviceName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowkoBookingStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FlowkoBookingAction" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "businessId" INTEGER NOT NULL,
    "action" "public"."FlowkoBookingActionKind" NOT NULL,
    "actorMemberId" INTEGER,
    "actorName" TEXT NOT NULL,
    "userId" INTEGER,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowkoBookingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FlowkoBusiness_slug_key" ON "public"."FlowkoBusiness"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "FlowkoBusinessMember_userId_key" ON "public"."FlowkoBusinessMember"("userId");

-- CreateIndex
CREATE INDEX "FlowkoBusinessMember_businessId_idx" ON "public"."FlowkoBusinessMember"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowkoBusinessInvite_tokenHash_key" ON "public"."FlowkoBusinessInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "FlowkoBusinessInvite_businessId_idx" ON "public"."FlowkoBusinessInvite"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowkoService_businessId_name_key" ON "public"."FlowkoService"("businessId", "name");

-- CreateIndex
CREATE INDEX "FlowkoServiceWorker_memberId_idx" ON "public"."FlowkoServiceWorker"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowkoBookingStep_bookingId_index_key" ON "public"."FlowkoBookingStep"("bookingId", "index");

-- CreateIndex
CREATE INDEX "FlowkoBookingAction_bookingId_idx" ON "public"."FlowkoBookingAction"("bookingId");

-- CreateIndex
CREATE INDEX "FlowkoBookingAction_businessId_createdAt_idx" ON "public"."FlowkoBookingAction"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."FlowkoBusinessMember" ADD CONSTRAINT "FlowkoBusinessMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."FlowkoBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoBusinessMember" ADD CONSTRAINT "FlowkoBusinessMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoBusinessInvite" ADD CONSTRAINT "FlowkoBusinessInvite_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."FlowkoBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoBusinessInvite" ADD CONSTRAINT "FlowkoBusinessInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoService" ADD CONSTRAINT "FlowkoService_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."FlowkoBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoServiceWorker" ADD CONSTRAINT "FlowkoServiceWorker_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."FlowkoService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoServiceWorker" ADD CONSTRAINT "FlowkoServiceWorker_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."FlowkoBusinessMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoBookingStep" ADD CONSTRAINT "FlowkoBookingStep_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoBookingStep" ADD CONSTRAINT "FlowkoBookingStep_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."FlowkoService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoBookingAction" ADD CONSTRAINT "FlowkoBookingAction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoBookingAction" ADD CONSTRAINT "FlowkoBookingAction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."FlowkoBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoBookingAction" ADD CONSTRAINT "FlowkoBookingAction_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "public"."FlowkoBusinessMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowkoBookingAction" ADD CONSTRAINT "FlowkoBookingAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddCheckConstraint: business slug is lowercase ASCII words joined by single hyphens (slugify keeps non-ASCII letters)
ALTER TABLE "public"."FlowkoBusiness" ADD CONSTRAINT "FlowkoBusiness_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- AddCheckConstraint: brand colours are stored as lowercase #rrggbb
ALTER TABLE "public"."FlowkoBusiness" ADD CONSTRAINT "FlowkoBusiness_brandColor_format" CHECK ("brandColor" IS NULL OR "brandColor" ~ '^#[0-9a-f]{6}$');

-- AddCheckConstraint: brand colours are stored as lowercase #rrggbb
ALTER TABLE "public"."FlowkoBusiness" ADD CONSTRAINT "FlowkoBusiness_darkBrandColor_format" CHECK ("darkBrandColor" IS NULL OR "darkBrandColor" ~ '^#[0-9a-f]{6}$');

-- AddCheckConstraint: slot grid is one of the supported steps
ALTER TABLE "public"."FlowkoBusiness" ADD CONSTRAINT "FlowkoBusiness_slotGridMinutes_allowed" CHECK ("slotGridMinutes" IN (5, 10, 15, 20, 30, 60));

-- AddCheckConstraint: self-cancel window between 0 and 168 hours (one week)
ALTER TABLE "public"."FlowkoBusiness" ADD CONSTRAINT "FlowkoBusiness_selfCancelHours_range" CHECK ("selfCancelHours" BETWEEN 0 AND 168);

-- AddCheckConstraint: a service's own slot grid is unset (business grid applies) or one of the supported steps
ALTER TABLE "public"."FlowkoService" ADD CONSTRAINT "FlowkoService_slotGridMinutes_allowed" CHECK ("slotGridMinutes" IS NULL OR "slotGridMinutes" IN (5, 10, 15, 20, 30, 60));

-- AddCheckConstraint: only STAFF may exist without a login (P2)
ALTER TABLE "public"."FlowkoBusinessMember" ADD CONSTRAINT "FlowkoBusinessMember_userId_required_unless_staff" CHECK ("userId" IS NOT NULL OR "role" = 'STAFF');

-- CreateIndex: one OWNER per business (P2); partial index, not expressible in schema.prisma
CREATE UNIQUE INDEX "FlowkoBusinessMember_one_owner" ON "public"."FlowkoBusinessMember"("businessId") WHERE "role" = 'OWNER';
