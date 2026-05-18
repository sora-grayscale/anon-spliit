jest.mock('@/lib/prisma', () => ({
  prisma: {
    group: {
      findUnique: jest.fn(),
    },
  },
}))
// Avoid pulling auth.ts (and its ESM @auth/prisma-adapter dep) into jest by
// stubbing the procedure builder. The handler itself doesn't need it.
jest.mock('@/trpc/init', () => ({
  publicProcedure: {
    input: () => ({ query: () => ({}) }),
  },
}))

import { prisma } from '@/lib/prisma'
import { TRPCError } from '@trpc/server'
import { revisionHandler } from './revision.procedure'

const mockFindUnique = prisma.group.findUnique as jest.MockedFunction<
  typeof prisma.group.findUnique
>

describe('revisionGroupExpensesProcedure handler (Issue #225)', () => {
  beforeEach(() => {
    mockFindUnique.mockReset()
  })

  it('returns the current revision for an existing group', async () => {
    mockFindUnique.mockResolvedValue({ expensesRevision: 42 } as never)
    const result = await revisionHandler({ input: { groupId: 'g1' } })
    expect(result).toEqual({ revision: 42 })
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'g1' },
      select: { expensesRevision: true },
    })
  })

  it('throws NOT_FOUND when the group does not exist', async () => {
    mockFindUnique.mockResolvedValue(null)
    await expect(
      revisionHandler({ input: { groupId: 'missing' } }),
    ).rejects.toThrow(TRPCError)
    await expect(
      revisionHandler({ input: { groupId: 'missing' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
