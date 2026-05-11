-- AlterTable
ALTER TABLE "Admin" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WhitelistUser" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
