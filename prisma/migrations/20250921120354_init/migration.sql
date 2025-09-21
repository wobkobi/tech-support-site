-- CreateEnum
CREATE TYPE "public"."BookingStatus" AS ENUM ('held', 'confirmed', 'cancelled');

-- CreateTable
CREATE TABLE "public"."Resource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Booking" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startUtc" TIMESTAMPTZ(6) NOT NULL,
    "endUtc" TIMESTAMPTZ(6) NOT NULL,
    "bufferBeforeMin" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMin" INTEGER NOT NULL DEFAULT 0,
    "status" "public"."BookingStatus" NOT NULL DEFAULT 'held',
    "holdExpiresUtc" TIMESTAMPTZ(6),
    "cancelToken" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Resource_name_key" ON "public"."Resource"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_cancelToken_key" ON "public"."Booking"("cancelToken");

-- CreateIndex
CREATE INDEX "Booking_resourceId_startUtc_endUtc_idx" ON "public"."Booking"("resourceId", "startUtc", "endUtc");

-- CreateIndex
CREATE INDEX "Booking_status_holdExpiresUtc_idx" ON "public"."Booking"("status", "holdExpiresUtc");

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "public"."Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
