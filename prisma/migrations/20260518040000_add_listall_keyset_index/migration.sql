-- CreateIndex
-- Keyset (cursor) pagination index for listAll (Issue #170).
-- Order must match the stable sort: expenseDate DESC, createdAt DESC, id DESC.
CREATE INDEX "Expense_groupId_expenseDate_createdAt_id_idx" ON "Expense"("groupId", "expenseDate" DESC, "createdAt" DESC, "id" DESC);
