/*
  Warnings:

  - You are about to drop the column `name` on the `Review` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."Review_createdAt_idx";

-- AlterTable
ALTER TABLE "Review" DROP COLUMN "name",
ADD COLUMN     "approved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastName" TEXT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);
