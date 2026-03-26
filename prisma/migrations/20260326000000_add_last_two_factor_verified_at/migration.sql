-- AlterTable
ALTER TABLE "Admin" ADD COLUMN "lastTwoFactorVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WhitelistUser" ADD COLUMN "lastTwoFactorVerifiedAt" TIMESTAMP(3);
