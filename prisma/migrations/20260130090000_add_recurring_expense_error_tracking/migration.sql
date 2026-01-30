-- AlterTable: Add error tracking fields to RecurringExpenseLink (Issue #82)
ALTER TABLE "RecurringExpenseLink" ADD COLUMN "lastError" TEXT;
ALTER TABLE "RecurringExpenseLink" ADD COLUMN "lastErrorAt" TIMESTAMP(3);
ALTER TABLE "RecurringExpenseLink" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
