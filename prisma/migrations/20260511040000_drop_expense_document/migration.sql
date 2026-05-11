-- DropForeignKey
ALTER TABLE "ExpenseDocument" DROP CONSTRAINT IF EXISTS "ExpenseDocument_expenseId_fkey";

-- DropTable
DROP TABLE IF EXISTS "ExpenseDocument";
